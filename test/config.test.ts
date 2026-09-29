import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { loadConfig, loadSources, ensureOutputDirs, resolveOutputPath, resolveRunSlug } from '../src/config';
import { captureConsole, cleanupTmpDirs, makeConfig, setEnv, tmpDir, write, type Captured } from './helpers';

let restoreEnv: () => void;
let con: Captured;
beforeEach(() => { restoreEnv = setEnv(); con = captureConsole(); });
afterEach(() => { con.restore(); restoreEnv(); cleanupTmpDirs(); });

describe('loadConfig', () => {
  it('falls back to defaults, with a warning, when the file is missing', () => {
    const config = loadConfig(path.join(tmpDir(), 'nope.yaml'));
    assert.equal(config.level, 'beginner');
    assert.equal(config.max_words_per_run, 4);
    assert.equal(config.min_word_length, 2);
    assert.equal(config.fetch_concurrency, 3);
    assert.equal(config.database.path, 'output/kotoba.db');
    assert.equal(config.translation.ollama.url, 'http://localhost:11434');
    assert.equal(config.publish, undefined);
    assert.match(con.warn.join('\n'), /not found — using defaults/);
  });

  it('returns a fresh copy of the defaults each time', () => {
    const missing = path.join(tmpDir(), 'nope.yaml');
    const a = loadConfig(missing);
    a.output.json = 'changed';
    a.tts.openai.voice = 'changed';
    const b = loadConfig(missing);
    assert.equal(b.output.json, 'output/data');
    assert.equal(b.tts.openai.voice, 'alloy');
  });

  it('overrides defaults with yaml values and keeps the rest', () => {
    const file = write(path.join(tmpDir(), 'c.yaml'), 'level: advanced\nmax_words_per_run: 9\n');
    const config = loadConfig(file);
    assert.equal(config.level, 'advanced');
    assert.equal(config.max_words_per_run, 9);
    assert.equal(config.max_examples_per_word, 2);
    assert.equal(config.tts.provider, 'auto');
  });

  it('merges nested sections key by key', () => {
    const file = write(path.join(tmpDir(), 'c.yaml'), [
      'output:', '  html: site',
      'database:', '  path: /var/kotoba.db',
      'tts:', '  provider: openai', '  openai:', '    voice: nova',
      '  elevenlabs:', '    model_id: turbo',
      'translation:', '  provider: ollama', '  ollama:', '    model: llama3',
    ].join('\n'));
    const config = loadConfig(file);
    assert.deepEqual(config.output, { json: 'output/data', html: 'site', markdown: 'output/web' });
    assert.equal(config.database.path, '/var/kotoba.db');
    assert.equal(config.tts.provider, 'openai');
    assert.deepEqual(config.tts.openai, { voice: 'nova', model: 'tts-1' });
    assert.equal(config.tts.elevenlabs.model_id, 'turbo');
    assert.equal(config.tts.elevenlabs.voice_id, 'pFZP5JQG7iQjIQuC4Bku');
    assert.equal(config.translation.provider, 'ollama');
    assert.deepEqual(config.translation.ollama, { url: 'http://localhost:11434', model: 'llama3' });
  });

  it('passes the publish section through', () => {
    const file = write(path.join(tmpDir(), 'c.yaml'), 'publish:\n  provider: s3\n  s3:\n    bucket: b\n');
    assert.deepEqual(loadConfig(file).publish, { provider: 's3', s3: { bucket: 'b' } });
  });

  it('rejects an invalid level', () => {
    const file = write(path.join(tmpDir(), 'c.yaml'), 'level: expert\n');
    assert.throws(() => loadConfig(file), /Invalid level "expert".*beginner, intermediate, advanced, all/);
  });

  for (const level of ['beginner', 'intermediate', 'advanced', 'all']) {
    it(`accepts level ${level}`, () => {
      const file = write(path.join(tmpDir(), 'c.yaml'), `level: ${level}\n`);
      assert.equal(loadConfig(file).level, level);
    });
  }

  it('resolves a relative config path against the working directory', () => {
    const dir = tmpDir();
    write(path.join(dir, 'rel.yaml'), 'max_words_per_run: 7\n');
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      assert.equal(loadConfig('rel.yaml').max_words_per_run, 7);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe('OLLAMA_* environment overrides', () => {
  const load = () => loadConfig(path.join(tmpDir(), 'nope.yaml'));

  it('leaves the file values alone when unset', () => {
    const file = write(path.join(tmpDir(), 'c.yaml'), 'translation:\n  ollama:\n    url: http://from-file:1\n    model: from-file\n');
    const config = loadConfig(file);
    assert.equal(config.translation.ollama.url, 'http://from-file:1');
    assert.equal(config.translation.ollama.model, 'from-file');
  });

  it('takes precedence over config.yaml', () => {
    restoreEnv();
    restoreEnv = setEnv({ OLLAMA_HOST: 'http://env-host:9', OLLAMA_MODEL: 'env-model' });
    const file = write(path.join(tmpDir(), 'c.yaml'), 'translation:\n  ollama:\n    url: http://from-file:1\n    model: from-file\n');
    const config = loadConfig(file);
    assert.equal(config.translation.ollama.url, 'http://env-host:9');
    assert.equal(config.translation.ollama.model, 'env-model');
  });

  const hosts: Array<[string, string]> = [
    ['dtop.home:11434', 'http://dtop.home:11434'],
    ['dtop.home', 'http://dtop.home'],
    ['http://dtop.home:11434', 'http://dtop.home:11434'],
    ['HTTPS://dtop.home', 'HTTPS://dtop.home'],
    ['https://dtop.home:11434///', 'https://dtop.home:11434'],
    ['  dtop.home:11434  ', 'http://dtop.home:11434'],
  ];
  for (const [input, expected] of hosts) {
    it(`OLLAMA_HOST=${JSON.stringify(input)} → ${expected}`, () => {
      restoreEnv();
      restoreEnv = setEnv({ OLLAMA_HOST: input });
      assert.equal(load().translation.ollama.url, expected);
    });
  }

  it('ignores blank values', () => {
    restoreEnv();
    restoreEnv = setEnv({ OLLAMA_HOST: '   ', OLLAMA_MODEL: '' });
    const config = load();
    assert.equal(config.translation.ollama.url, 'http://localhost:11434');
    assert.equal(config.translation.ollama.model, 'translategemma:27b');
  });

  it('applies to the defaults when config.yaml is missing', () => {
    restoreEnv();
    restoreEnv = setEnv({ OLLAMA_MODEL: 'm' });
    assert.equal(load().translation.ollama.model, 'm');
  });
});

describe('loadSources', () => {
  const feeds = [
    'feeds:',
    '  - {name: A, url: http://a, domain: news}',
    '  - {name: B, url: http://b, domain: news, enabled: false}',
    '  - {name: C, url: http://c, domain: sci, enabled: true, type: json, json: {urlField: link}}',
  ].join('\n');

  it('returns enabled feeds and drops disabled ones', () => {
    const file = write(path.join(tmpDir(), 's.yaml'), feeds);
    const loaded = loadSources(file);
    assert.deepEqual(loaded.map(f => f.name), ['A', 'C']);
    assert.equal(loaded[1].type, 'json');
    assert.deepEqual(loaded[1].json, { urlField: 'link' });
  });

  it('throws when the file is missing', () => {
    assert.throws(() => loadSources(path.join(tmpDir(), 'none.yaml')), /sources\.yaml not found/);
  });

  it('throws when there is no feeds array', () => {
    assert.throws(() => loadSources(write(path.join(tmpDir(), 's.yaml'), 'other: 1')), /must contain a "feeds" array/);
    assert.throws(() => loadSources(write(path.join(tmpDir(), 't.yaml'), 'feeds: nope')), /must contain a "feeds" array/);
  });

  it('throws when every feed is disabled', () => {
    const file = write(path.join(tmpDir(), 's.yaml'), 'feeds:\n  - {name: A, url: http://a, domain: d, enabled: false}\n');
    assert.throws(() => loadSources(file), /No enabled feeds/);
  });
});

describe('output paths', () => {
  it('ensureOutputDirs creates every output dir, the db dir and audio/', () => {
    const root = tmpDir();
    const config = makeConfig(path.join(root, 'nested'));
    config.output.markdown = path.join(root, 'md');
    config.database.path = path.join(root, 'db', 'sub', 'k.db');
    ensureOutputDirs(config);
    for (const d of [config.output.json, config.output.html, config.output.markdown, path.dirname(config.database.path), path.join(config.output.html, 'audio')]) {
      assert.ok(fs.statSync(d).isDirectory(), d);
    }
  });

  it('ensureOutputDirs is idempotent', () => {
    const config = makeConfig(tmpDir());
    ensureOutputDirs(config);
    assert.doesNotThrow(() => ensureOutputDirs(config));
  });

  it('resolveOutputPath joins absolute dirs and resolves relative ones from the cwd', () => {
    assert.equal(resolveOutputPath('/x/y', 'f.json'), path.join('/x/y', 'f.json'));
    assert.equal(resolveOutputPath('out', 'f.json'), path.join(process.cwd(), 'out', 'f.json'));
  });
});

describe('resolveRunSlug', () => {
  it('uses the bare date when no digest exists', () => {
    assert.equal(resolveRunSlug('2026-09-01', tmpDir()), '2026-09-01');
  });

  it('appends -2, -3 for later runs the same day', () => {
    const dir = tmpDir();
    write(path.join(dir, 'digest-2026-09-01.html'), '');
    assert.equal(resolveRunSlug('2026-09-01', dir), '2026-09-01-2');
    write(path.join(dir, 'digest-2026-09-01-2.html'), '');
    assert.equal(resolveRunSlug('2026-09-01', dir), '2026-09-01-3');
  });

  it('ignores other days and non-html files', () => {
    const dir = tmpDir();
    write(path.join(dir, 'digest-2026-08-31.html'), '');
    write(path.join(dir, 'digest-2026-09-01.md'), '');
    assert.equal(resolveRunSlug('2026-09-01', dir), '2026-09-01');
  });

  it('works when the directory does not exist yet', () => {
    assert.equal(resolveRunSlug('2026-09-01', path.join(tmpDir(), 'missing')), '2026-09-01');
  });
});
