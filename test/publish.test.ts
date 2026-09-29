import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import path from 'path';
import {
  S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { publishOutput } from '../src/publish';
import type { AppConfig, PublishConfig } from '../src/types';
import { captureConsole, cleanupTmpDirs, makeConfig, setEnv, tmpDir, write, type Captured } from './helpers';

const md5 = (content: string | Buffer) => crypto.createHash('md5').update(content).digest('hex');

interface Remote { key: string; etag?: string }

let con: Captured;
let restoreEnv: () => void;
let root: string;
let webDir: string;

/** Everything sent to S3 and CloudFront, plus the clients that sent it. */
let sent: Array<ListObjectsV2Command | PutObjectCommand | DeleteObjectCommand>;
let clients: S3Client[];
let invalidations: CreateInvalidationCommand[];
let remote: Remote[];
let pageSize: number;

beforeEach(() => {
  con = captureConsole();
  restoreEnv = setEnv();
  root = tmpDir();
  webDir = path.join(root, 'web');
  sent = []; clients = []; invalidations = []; remote = []; pageSize = 1000;

  mock.method(S3Client.prototype, 'send', async function (this: S3Client, command: unknown) {
    clients.push(this);
    sent.push(command as never);
    if (command instanceof ListObjectsV2Command) {
      const { Prefix, ContinuationToken } = command.input;
      const matching = remote.filter(r => !Prefix || r.key.startsWith(Prefix));
      const start = ContinuationToken ? Number(ContinuationToken) : 0;
      const page = matching.slice(start, start + pageSize);
      const more = start + pageSize < matching.length;
      return {
        Contents: page.map(r => ({ Key: r.key, ETag: r.etag !== undefined ? `"${r.etag}"` : undefined })),
        NextContinuationToken: more ? String(start + pageSize) : undefined,
      } satisfies Partial<ListObjectsV2CommandOutput>;
    }
    return {};
  });
  mock.method(CloudFrontClient.prototype, 'send', async (command: unknown) => {
    invalidations.push(command as CreateInvalidationCommand);
    return {};
  });
});
afterEach(() => { mock.restoreAll(); restoreEnv(); con.restore(); cleanupTmpDirs(); });

const configWith = (publish: PublishConfig | undefined): AppConfig => {
  const c = makeConfig(root);
  c.output.html = webDir;
  c.publish = publish;
  return c;
};
const s3 = (extra: Partial<NonNullable<PublishConfig['s3']>> = {}): PublishConfig => ({ provider: 's3', s3: { bucket: 'my-bucket', ...extra } });

const puts = () => sent.filter((c): c is PutObjectCommand => c instanceof PutObjectCommand);
const deletes = () => sent.filter((c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand);
const lists = () => sent.filter((c): c is ListObjectsV2Command => c instanceof ListObjectsV2Command);
const putKeys = () => puts().map(c => c.input.Key).sort();
const deleteKeys = () => deletes().map(c => c.input.Key).sort();

describe('publishOutput: configuration', () => {
  it('refuses to run without a publish section', async () => {
    write(path.join(webDir, 'index.html'), 'x');
    await assert.rejects(publishOutput(configWith(undefined)), /No publish config in config\.yaml/);
    assert.equal(sent.length, 0);
  });

  it('S3 needs a bucket from the config or S3_BUCKET', async () => {
    write(path.join(webDir, 'index.html'), 'x');
    await assert.rejects(publishOutput(configWith({ provider: 's3' })), /publish\.s3\.bucket is required/);
    restoreEnv(); restoreEnv = setEnv({ S3_BUCKET: 'from-env' });
    await publishOutput(configWith({ provider: 's3' }));
    assert.equal(puts()[0].input.Bucket, 'from-env');
  });

  it('prefers the configured S3 bucket over the environment', async () => {
    restoreEnv(); restoreEnv = setEnv({ S3_BUCKET: 'from-env' });
    write(path.join(webDir, 'index.html'), 'x');
    await publishOutput(configWith(s3()));
    assert.equal(puts()[0].input.Bucket, 'my-bucket');
  });

  it('uses the configured region, then AWS_REGION, then us-east-1', async () => {
    write(path.join(webDir, 'index.html'), 'x');
    const regionOf = async () => clients.at(-1)!.config.region();

    await publishOutput(configWith(s3({ region: 'eu-west-1' })));
    assert.equal(await regionOf(), 'eu-west-1');

    restoreEnv(); restoreEnv = setEnv({ AWS_REGION: 'ap-northeast-1' });
    await publishOutput(configWith(s3()));
    assert.equal(await regionOf(), 'ap-northeast-1');

    restoreEnv(); restoreEnv = setEnv();
    await publishOutput(configWith(s3()));
    assert.equal(await regionOf(), 'us-east-1');
  });

  describe('R2', () => {
    const r2 = (over: Partial<NonNullable<PublishConfig['r2']>> = {}): PublishConfig => ({
      provider: 'r2', r2: { bucket: 'r2-bucket', account_id: 'acct123', ...over },
    });
    const creds = { CLOUDFLARE_R2_ACCESS_KEY_ID: 'id', CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret' };

    it('needs a bucket and an account id', async () => {
      restoreEnv(); restoreEnv = setEnv(creds);
      write(path.join(webDir, 'index.html'), 'x');
      await assert.rejects(publishOutput(configWith({ provider: 'r2', r2: { account_id: 'a' } })), /R2_BUCKET.*account_id are required/);
      await assert.rejects(publishOutput(configWith({ provider: 'r2', r2: { bucket: 'b' } as never })), /account_id are required/);
      await assert.rejects(publishOutput(configWith({ provider: 'r2' })), /account_id are required/);
    });

    it('takes the bucket from R2_BUCKET when not configured', async () => {
      restoreEnv(); restoreEnv = setEnv({ ...creds, R2_BUCKET: 'env-bucket' });
      write(path.join(webDir, 'index.html'), 'x');
      await publishOutput(configWith({ provider: 'r2', r2: { account_id: 'acct123' } }));
      assert.equal(puts()[0].input.Bucket, 'env-bucket');
    });

    it('needs both credentials', async () => {
      write(path.join(webDir, 'index.html'), 'x');
      await assert.rejects(publishOutput(configWith(r2())), /CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY must be set/);
      restoreEnv(); restoreEnv = setEnv({ CLOUDFLARE_R2_ACCESS_KEY_ID: 'id' });
      await assert.rejects(publishOutput(configWith(r2())), /must be set/);
    });

    it('talks to the account\'s R2 endpoint in region "auto"', async () => {
      restoreEnv(); restoreEnv = setEnv(creds);
      write(path.join(webDir, 'index.html'), 'x');
      await publishOutput(configWith(r2()));
      const client = clients[0];
      assert.equal(await client.config.region(), 'auto');
      const endpoint = await client.config.endpoint!();
      assert.equal(endpoint.hostname, 'acct123.r2.cloudflarestorage.com');
      assert.equal(endpoint.protocol, 'https:');
      assert.equal(puts()[0].input.Bucket, 'r2-bucket');
    });
  });
});

describe('publishOutput: syncing', () => {
  it('uploads new files, keyed by their path relative to the output directory', async () => {
    write(path.join(webDir, 'index.html'), '<h1>hi</h1>');
    write(path.join(webDir, 'audio', 'a.mp3'), 'mp3');
    write(path.join(webDir, 'sub', 'deep', 'x.json'), '{}');
    await publishOutput(configWith(s3()));
    assert.deepEqual(putKeys(), ['audio/a.mp3', 'index.html', 'sub/deep/x.json']);
    assert.equal(puts().find(c => c.input.Key === 'index.html')?.input.Body?.toString(), '<h1>hi</h1>');
    assert.match(con.log.join('\n'), /3 uploaded, 0 deleted, 0 unchanged/);
  });

  it('sets a content type from the extension', async () => {
    const files: Record<string, string> = {
      'a.html': 'text/html; charset=utf-8', 'a.json': 'application/json', 'a.md': 'text/markdown; charset=utf-8',
      'a.mp3': 'audio/mpeg', 'a.txt': 'text/plain; charset=utf-8', 'a.png': 'application/octet-stream', 'noext': 'application/octet-stream',
      'A.HTML': 'text/html; charset=utf-8',
    };
    for (const f of Object.keys(files)) write(path.join(webDir, f), 'x');
    await publishOutput(configWith(s3()));
    for (const [f, type] of Object.entries(files)) {
      assert.equal(puts().find(c => c.input.Key === f)?.input.ContentType, type, f);
    }
  });

  it('skips files whose MD5 matches the remote ETag', async () => {
    write(path.join(webDir, 'same.html'), 'same');
    write(path.join(webDir, 'changed.html'), 'new');
    write(path.join(webDir, 'fresh.html'), 'fresh');
    remote = [{ key: 'same.html', etag: md5('same') }, { key: 'changed.html', etag: md5('old') }];
    await publishOutput(configWith(s3()));
    assert.deepEqual(putKeys(), ['changed.html', 'fresh.html']);
    assert.match(con.log.join('\n'), /2 uploaded, 0 deleted, 1 unchanged/);
  });

  it('deletes remote files that no longer exist locally', async () => {
    write(path.join(webDir, 'keep.html'), 'keep');
    remote = [{ key: 'keep.html', etag: md5('keep') }, { key: 'gone.html', etag: 'x' }, { key: 'audio/old.mp3', etag: 'y' }];
    await publishOutput(configWith(s3()));
    assert.deepEqual(deleteKeys(), ['audio/old.mp3', 'gone.html']);
    assert.deepEqual(putKeys(), []);
    assert.match(con.log.join('\n'), /0 uploaded, 2 deleted, 1 unchanged/);
  });

  it('reads every page of a paginated listing', async () => {
    pageSize = 2;
    write(path.join(webDir, 'f0.html'), 'f0');
    remote = Array.from({ length: 5 }, (_, i) => ({ key: `f${i}.html`, etag: md5(`f${i}`) }));
    await publishOutput(configWith(s3()));
    assert.equal(lists().length, 3);
    assert.deepEqual(lists().map(c => c.input.ContinuationToken), [undefined, '2', '4']);
    assert.deepEqual(putKeys(), []);
    assert.deepEqual(deleteKeys(), ['f1.html', 'f2.html', 'f3.html', 'f4.html']);
  });

  it('uploads everything when the bucket is empty', async () => {
    write(path.join(webDir, 'a.html'), 'a');
    await publishOutput(configWith(s3()));
    assert.deepEqual(putKeys(), ['a.html']);
    assert.deepEqual(deletes(), []);
  });

  it('re-uploads when a remote object has no ETag', async () => {
    write(path.join(webDir, 'a.html'), 'a');
    remote = [{ key: 'a.html' }];
    await publishOutput(configWith(s3()));
    assert.deepEqual(putKeys(), ['a.html']);
  });

  it('is a no-op when nothing changed', async () => {
    write(path.join(webDir, 'a.html'), 'a');
    remote = [{ key: 'a.html', etag: md5('a') }];
    await publishOutput(configWith(s3()));
    assert.equal(puts().length + deletes().length, 0);
    assert.match(con.log.join('\n'), /0 uploaded, 0 deleted, 1 unchanged/);
  });

  it('compares binary files byte for byte', async () => {
    const bytes = Buffer.from([0, 255, 128, 10, 13]);
    write(path.join(webDir, 'a.mp3'), bytes);
    remote = [{ key: 'a.mp3', etag: md5(bytes) }];
    await publishOutput(configWith(s3()));
    assert.equal(puts().length, 0);
  });

  it('fails when the output directory does not exist', async () => {
    await assert.rejects(publishOutput(configWith(s3())), /ENOENT/);
  });
});

describe('publishOutput: prefix', () => {
  it('prefixes uploaded keys and lists only under the prefix', async () => {
    write(path.join(webDir, 'index.html'), 'x');
    write(path.join(webDir, 'audio', 'a.mp3'), 'y');
    await publishOutput(configWith(s3({ prefix: 'kotoba' })));
    assert.deepEqual(putKeys(), ['kotoba/audio/a.mp3', 'kotoba/index.html']);
    assert.equal(lists()[0].input.Prefix, 'kotoba/', 'listed as a folder');
  });

  it('compares against, and deletes among, prefixed remote keys', async () => {
    write(path.join(webDir, 'index.html'), 'x');
    remote = [{ key: 'kotoba/index.html', etag: md5('x') }, { key: 'kotoba/old.html', etag: 'z' }, { key: 'other/keep.html', etag: 'q' }];
    await publishOutput(configWith(s3({ prefix: 'kotoba' })));
    assert.deepEqual(putKeys(), []);
    assert.deepEqual(deleteKeys(), ['kotoba/old.html']);
  });

  it('lists the whole bucket when there is no prefix', async () => {
    write(path.join(webDir, 'index.html'), 'x');
    await publishOutput(configWith(s3()));
    assert.equal(lists()[0].input.Prefix, undefined);
  });

  it('never touches keys that merely start with the prefix', async () => {
    write(path.join(webDir, 'index.html'), 'x');
    remote = [{ key: 'kotoba-backup/index.html', etag: 'b' }, { key: 'kotoba.txt', etag: 'c' }, { key: 'kotoba/old.html', etag: 'd' }];
    await publishOutput(configWith(s3({ prefix: 'kotoba' })));
    assert.deepEqual(deleteKeys(), ['kotoba/old.html']);
    assert.deepEqual(putKeys(), ['kotoba/index.html']);
  });

  it('treats "kotoba/" and "kotoba" alike', async () => {
    write(path.join(webDir, 'index.html'), 'x');
    remote = [{ key: 'kotoba/index.html', etag: md5('x') }, { key: 'kotoba/old.html', etag: 'd' }];
    await publishOutput(configWith(s3({ prefix: 'kotoba///' })));
    assert.equal(lists()[0].input.Prefix, 'kotoba/');
    assert.deepEqual(putKeys(), [], 'no "kotoba//index.html"');
    assert.deepEqual(deleteKeys(), ['kotoba/old.html']);
  });

  it('applies to R2 as well', async () => {
    restoreEnv(); restoreEnv = setEnv({ CLOUDFLARE_R2_ACCESS_KEY_ID: 'id', CLOUDFLARE_R2_SECRET_ACCESS_KEY: 's' });
    write(path.join(webDir, 'index.html'), 'x');
    remote = [{ key: 'site-old/a.html', etag: 'b' }];
    await publishOutput(configWith({ provider: 'r2', r2: { bucket: 'b', account_id: 'a', prefix: 'site/' } }));
    assert.equal(lists()[0].input.Prefix, 'site/');
    assert.deepEqual(putKeys(), ['site/index.html']);
    assert.deepEqual(deletes(), []);
  });
});

describe('publishOutput: CloudFront', () => {
  it('does not invalidate without a distribution id', async () => {
    write(path.join(webDir, 'index.html'), 'x');
    await publishOutput(configWith(s3()));
    assert.equal(invalidations.length, 0);
  });

  it('invalidates everything when a distribution id is set', async () => {
    restoreEnv(); restoreEnv = setEnv({ CLOUDFRONT_DISTRIBUTION_ID: 'E123ABC' });
    write(path.join(webDir, 'index.html'), 'x');
    await publishOutput(configWith(s3()));
    assert.equal(invalidations.length, 1);
    const batch = invalidations[0].input;
    assert.equal(batch.DistributionId, 'E123ABC');
    assert.deepEqual(batch.InvalidationBatch?.Paths, { Quantity: 1, Items: ['/*'] });
    assert.match(batch.InvalidationBatch?.CallerReference ?? '', /^\d+$/);
    assert.match(con.log.join('\n'), /Invalidation created/);
  });

  it('invalidates even when nothing was uploaded', async () => {
    restoreEnv(); restoreEnv = setEnv({ CLOUDFRONT_DISTRIBUTION_ID: 'E123ABC' });
    write(path.join(webDir, 'index.html'), 'x');
    remote = [{ key: 'index.html', etag: md5('x') }];
    await publishOutput(configWith(s3()));
    assert.equal(invalidations.length, 1);
  });
});
