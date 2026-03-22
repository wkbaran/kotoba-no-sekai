import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import type { AppConfig } from './types.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.md':   'text/markdown; charset=utf-8',
  '.mp3':  'audio/mpeg',
  '.txt':  'text/plain; charset=utf-8',
};

function mimeType(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function md5(file: string): string {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function buildClient(config: AppConfig): { client: S3Client; bucket: string; prefix: string } {
  const pub = config.publish!;

  if (pub.provider === 'r2') {
    const r2 = pub.r2;
    const r2Bucket = r2?.bucket ?? process.env.R2_BUCKET;
    if (!r2Bucket || !r2?.account_id) {
      throw new Error('publish.r2.bucket (or R2_BUCKET env var) and publish.r2.account_id are required for R2');
    }
    const accessKeyId     = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ?? '';
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? '';
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY must be set');
    }
    return {
      client: new S3Client({
        region: 'auto',
        endpoint: `https://${r2.account_id}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      }),
      bucket: r2Bucket,
      prefix: r2.prefix ?? '',
    };
  }

  // Default: S3
  const s3 = pub.s3;
  const s3Bucket = s3?.bucket ?? process.env.S3_BUCKET;
  if (!s3Bucket) {
    throw new Error('publish.s3.bucket is required (or set S3_BUCKET env var)');
  }
  // Credentials come from env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) or ~/.aws/credentials
  return {
    client: new S3Client({
      region: s3?.region ?? process.env.AWS_REGION ?? 'us-east-1',
    }),
    bucket: s3Bucket,
    prefix: s3?.prefix ?? '',
  };
}

export async function publishOutput(config: AppConfig): Promise<void> {
  if (!config.publish) {
    throw new Error('No publish config in config.yaml. Add a publish section to use --publish.');
  }

  const { client, bucket, prefix } = buildClient(config);
  const localDir = path.resolve(process.cwd(), config.output.html);

  // Build local file map: s3-key → local path
  const localFiles = walk(localDir);
  const localMap = new Map<string, string>();
  for (const f of localFiles) {
    const rel = path.relative(localDir, f).replace(/\\/g, '/');
    const key = prefix ? `${prefix}/${rel}` : rel;
    localMap.set(key, f);
  }

  // List all remote objects (paginated)
  const remoteMap = new Map<string, string>(); // key → etag
  let token: string | undefined;
  do {
    const resp = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: token,
    }));
    for (const obj of resp.Contents ?? []) {
      if (obj.Key && obj.ETag) {
        remoteMap.set(obj.Key, obj.ETag.replace(/"/g, ''));
      }
    }
    token = resp.NextContinuationToken;
  } while (token);

  // Upload new or changed files
  let uploaded = 0;
  for (const [key, localPath] of localMap) {
    if (md5(localPath) === remoteMap.get(key)) continue;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.readFileSync(localPath),
      ContentType: mimeType(localPath),
    }));
    console.log(`[publish] ↑ ${key}`);
    uploaded++;
  }

  // Delete remote files that no longer exist locally
  let deleted = 0;
  for (const key of remoteMap.keys()) {
    if (!localMap.has(key)) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      console.log(`[publish] ✕ ${key}`);
      deleted++;
    }
  }

  const unchanged = localMap.size - uploaded;
  console.log(`[publish] ✓ ${uploaded} uploaded, ${deleted} deleted, ${unchanged} unchanged`);

  // Invalidate CloudFront cache if a distribution ID is configured
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  if (distributionId) {
    console.log(`[publish] Invalidating CloudFront distribution ${distributionId}...`);
    const cf = new CloudFrontClient({ region: 'us-east-1' });
    await cf.send(new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: { Quantity: 1, Items: ['/*'] },
      },
    }));
    console.log('[publish] Invalidation created.');
  }
}
