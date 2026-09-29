import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { WordDatabase } from '../src/db';
import { cleanupTmpDirs, makeRecord, read, startServer, tmpDir, write, type TestServer } from './helpers';

// These run the real entry point in a child process, from the repo root (the tokenizer
// finds its dictionary relative to the working directory).
const ROOT = path.resolve(__dirname, '..');

interface Result { code: number; stdout: string; stderr: string }

function kotoba(args: string[], env: Record<string, string> = {}): Promise<Result> {
  const clean = { ...process.env };
  for (const k of ['OLLAMA_HOST', 'OLLAMA_MODEL', 'OLLAMA_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'DEBUG']) delete clean[k];
  return new Promise(resolve => {
    execFile(
      process.execPath, ['--require', './test/register.cjs', 'src/index.ts', ...args],
      { cwd: ROOT, env: { ...clean, TS_NODE_TRANSPILE_ONLY: '1', ...env }, timeout: 60_000 },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }),
    );
  });
}

// A URL on a port nothing listens on, so connections are refused at once. (Unlike a
// well-known port such as 9, which some networks drop, leaving the feed parser waiting.)
let dead: string;
before(async () => { const s = await startServer({}); dead = s.url; await s.close(); });

// The tests run concurrently (each is a separate process), so temp directories are removed
// once at the end rather than after each test.
after(() => cleanupTmpDirs());

const OPTS = { concurrency: 8 };

/** A project directory: config.yaml and sources.yaml, with all output inside it. */
function project(over: { config?: string; sources?: string } = {}) {
  const dir = tmpDir();
  const config = write(path.join(dir, 'config.yaml'), over.config ?? [
    'level: all',
    'output:', `  json: ${dir}/data`, `  html: ${dir}/web`, `  markdown: ${dir}/web`,
    'database:', `  path: ${dir}/kotoba.db`,
    'tts:', '  provider: disabled',
    'translation:', '  provider: disabled',
  ].join('\n'));
  const sources = write(path.join(dir, 'sources.yaml'), over.sources ?? `feeds:\n  - {name: Test Feed, url: "${dead}/feed.xml", domain: news}\n`);
  return { dir, config, sources, web: path.join(dir, 'web'), data: path.join(dir, 'data'), db: path.join(dir, 'kotoba.db') };
}

describe('CLI', OPTS, () => {

describe('--help', OPTS, () => {
  for (const flag of ['--help', '-h']) {
    it(`${flag} prints usage and exits 0`, async () => {
      const r = await kotoba([flag]);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /Kotoba no Sekai/);
      for (const opt of ['--config', '--sources', '--level', '--max', '--dry-run', '--word', '--source', '--url', '--publish', '--rebuild-index', '--rebuild-digests', '--backfill-reviews']) {
        assert.ok(r.stdout.includes(opt), opt);
      }
    });
  }

  it('needs no config file', async () => {
    const r = await kotoba(['--help', '--config', '/nonexistent/config.yaml']);
    assert.equal(r.code, 0);
  });
});

describe('configuration errors', OPTS, () => {
  it('fails on an invalid level in config.yaml', async () => {
    const p = project({ config: 'level: expert\n' });
    const r = await kotoba(['--config', p.config, '--sources', p.sources]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /Invalid level "expert"/);
  });

  it('fails when sources.yaml is missing', async () => {
    const p = project();
    const r = await kotoba(['--config', p.config, '--sources', path.join(p.dir, 'nope.yaml')]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /sources\.yaml not found/);
  });

  it('fails on an invalid --level, listing the choices', async () => {
    const p = project();
    const r = await kotoba(['--config', p.config, '--sources', p.sources, '--level', 'expert']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Invalid level: "expert"\. Must be one of: beginner, intermediate, advanced, all/);
  });

  for (const bad of ['0', '-3', 'abc']) {
    it(`fails on --max ${bad}`, async () => {
      const p = project();
      const r = await kotoba(['--config', p.config, '--sources', p.sources, '--max', bad]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /--max must be a positive integer/);
    });
  }

  it('--publish fails without a publish section', async () => {
    const p = project();
    const r = await kotoba(['--config', p.config, '--publish']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /No publish config in config\.yaml/);
  });
});

describe('running modes', OPTS, () => {
  it('--source fails for an unknown source, naming the known ones', async () => {
    const p = project();
    const r = await kotoba(['--config', p.config, '--sources', p.sources, '--source', 'Nope']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\[error\] Source "Nope" not found in sources\.yaml\. Available: Test Feed/);
  });

  it('--url fails when the article cannot be read', async () => {
    const p = project();
    const r = await kotoba(['--config', p.config, '--sources', p.sources, '--url', `${dead}/story`]);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`[error] Could not extract usable text from ${dead}/story`), r.stderr);
  });

  it('creates the output directories before running', async () => {
    const p = project();
    await kotoba(['--config', p.config, '--sources', p.sources, '--source', 'Nope']);
    assert.ok(fs.statSync(path.join(p.web, 'audio')).isDirectory());
    assert.ok(fs.statSync(p.data).isDirectory());
  });

  it('prints a banner with the level and feed count', async () => {
    const p = project();
    const r = await kotoba(['--config', p.config, '--sources', p.sources, '--level', 'advanced', '--source', 'Nope']);
    assert.match(r.stdout, /言葉の世界 — World of Words/);
    assert.match(r.stdout, /level: advanced {2}\| {2}feeds: 1/);
  });

  it('applies --level and --max over the config', async () => {
    const p = project();
    const r = await kotoba(['--config', p.config, '--sources', p.sources, '--level', 'intermediate', '--max', '7', '--dry-run'], {});
    assert.match(r.stdout, /level: intermediate/);
  });

  it('only counts enabled feeds', async () => {
    const p = project({ sources: `feeds:\n  - {name: A, url: "${dead}/a", domain: d}\n  - {name: B, url: "${dead}/b", domain: d, enabled: false}\n` });
    const r = await kotoba(['--config', p.config, '--sources', p.sources, '--source', 'A']);
    assert.match(r.stdout, /feeds: 1/);
  });

  it('--dry-run reads a feed and prints candidate words without writing anything', async () => {
    const body = '<p>' + '公園で子供たちが元気に遊んでいます。天気が良い日は特に人が多いです。'.repeat(10) + '</p>';
    const server: TestServer = await startServer({
      '/feed.xml': base => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>Park story</title><link>${base}/a</link><description><![CDATA[${body}]]></description></item></channel></rss>`,
    });
    const p = project({ sources: `feeds:\n  - {name: Local, url: "${server.url}/feed.xml", domain: news}\n` });
    let r: Result;
    try {
      r = await kotoba(['--config', p.config, '--sources', p.sources, '--dry-run']);
    } finally {
      await server.close();
    }
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /\[dry-run\] Fetching articles/);
    assert.match(r.stdout, /\[Local\] 1 articles/);
    assert.match(r.stdout, /Article: Park story/);
    assert.match(r.stdout, /Candidates \(first 10\): .*公園/);
    assert.ok(!fs.existsSync(p.web), 'no output directories');
    assert.ok(!fs.existsSync(p.db), 'no database');
  });
});

describe('--rebuild-index', OPTS, () => {
  it('rebuilds the index pages from what is on disk and exits 0', async () => {
    const p = project();
    write(path.join(p.web, 'digest-2026-09-01.html'), 'x');
    write(path.join(p.data, 'words-2026-09-01.json'), JSON.stringify({ fullRecords: [makeRecord({ word: '猫', definition: 'cat' })] }));
    const r = await kotoba(['--config', p.config, '--rebuild-index']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /index\.html rebuilt \(1 entry\)/);
    assert.match(read(path.join(p.web, 'index.html')), /digest-2026-09-01\.html#w1/);
    assert.match(read(path.join(p.web, 'words.html')), /猫/);
    assert.ok(!r.stdout.includes('World of Words'), 'no pipeline banner');
  });

  it('does not need sources.yaml', async () => {
    const p = project();
    fs.rmSync(p.sources);
    fs.mkdirSync(p.web, { recursive: true });
    const r = await kotoba(['--config', p.config, '--rebuild-index']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(read(path.join(p.web, 'index.html')), /No days yet/);
  });

  it('exits 1 when the output directory does not exist', async () => {
    const p = project();
    const r = await kotoba(['--config', p.config, '--rebuild-index']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\[index\] Could not read output directory/);
  });
});

describe('--rebuild-digests', OPTS, () => {
  it('re-renders existing digests from their JSON and exits 0', async () => {
    const p = project();
    write(path.join(p.web, 'digest-2026-09-01.html'), 'stale');
    write(path.join(p.data, 'words-2026-09-01.json'), JSON.stringify({ fullRecords: [makeRecord({ word: '猫' })] }));
    const r = await kotoba(['--config', p.config, '--rebuild-digests']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /1 digest page rebuilt/);
    assert.match(read(path.join(p.web, 'digest-2026-09-01.html')), /<h2 class="word" lang="ja">猫<\/h2>/);
  });
});

describe('--backfill-reviews', OPTS, () => {
  const legacyRow = (dbPath: string, word: string, reading: string, json: string | null = null) => {
    const conn = new Database(dbPath);
    conn.prepare('INSERT INTO seen_words (word, reading, example_length, seen_at, record_json) VALUES (?, ?, 0, ?, ?)').run(word, reading, '2026-01-01', json);
    conn.close();
  };

  it('adds snapshots for words taught before review existed', async () => {
    const p = project();
    new WordDatabase(p.db).close();
    legacyRow(p.db, '猫', 'ねこ');
    legacyRow(p.db, '犬', 'いぬ', JSON.stringify(makeRecord({ word: '犬', reading: 'いぬ' })));
    write(path.join(p.data, 'words-2026-08-01.json'), JSON.stringify({ fullRecords: [
      makeRecord({ word: '猫', reading: 'ねこ' }), makeRecord({ word: '犬', reading: 'いぬ' }), makeRecord({ word: '鳥', reading: 'とり' }),
    ] }));
    write(path.join(p.data, 'words-2026-08-02.json'), '{corrupt');
    write(path.join(p.data, 'words-2026-08-03.json'), JSON.stringify([makeRecord({ word: '猫', reading: 'ねこ' })]));
    write(path.join(p.data, 'unrelated.json'), '{}');

    const r = await kotoba(['--config', p.config, '--backfill-reviews']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Scanning 3 file\(s\)/);
    assert.match(r.stdout, /Scanned 4 historical record\(s\) across 3 file\(s\) \(1 unreadable\)/);
    assert.match(r.stdout, /1 snapshot\(s\) added/);
    assert.match(r.stdout, /2 already had a snapshot/);
    assert.match(r.stdout, /1 had no matching database row/);

    const conn = new Database(p.db, { readonly: true });
    const row = conn.prepare("SELECT record_json FROM seen_words WHERE word = '猫'").get() as { record_json: string };
    conn.close();
    assert.equal(JSON.parse(row.record_json).word, '猫');
  });

  it('copes with no data directory', async () => {
    const p = project();
    const r = await kotoba(['--config', p.config, '--backfill-reviews']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Scanning 0 file\(s\)/);
  });
});

describe('argument parsing', OPTS, () => {
  it('takes a value after an option, but treats a following option as a flag', async () => {
    const p = project();
    // --level is followed by another option, so it is a bare flag and not a string: no override, no error.
    const r = await kotoba(['--config', p.config, '--sources', p.sources, '--level', '--source', 'Nope']);
    assert.match(r.stdout, /level: all/);
    assert.match(r.stderr, /Source "Nope" not found/);
  });

  it('ignores stray positional arguments', async () => {
    const p = project();
    const r = await kotoba(['stray', '--config', p.config, '--sources', p.sources, '--source', 'Nope']);
    assert.match(r.stderr, /Source "Nope" not found/);
  });
});

});
