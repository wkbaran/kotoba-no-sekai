import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { loadConfig, loadSources } from '../src/config';
import { captureConsole, setEnv, type Captured } from './helpers';

// Guards on the files the project ships, so a typo in config.yaml or sources.yaml fails here
// and not at 05:00.
const ROOT = path.resolve(__dirname, '..');

let con: Captured;
let restoreEnv: () => void;
beforeEach(() => { con = captureConsole(); restoreEnv = setEnv(); });
afterEach(() => { con.restore(); restoreEnv(); });

describe('shipped config.yaml', () => {
  it('loads without warnings', () => {
    const config = loadConfig(path.join(ROOT, 'config.yaml'));
    assert.deepEqual(con.warn, []);
    assert.ok(['beginner', 'intermediate', 'advanced', 'all'].includes(config.level));
  });

  it('has sane numeric settings', () => {
    const c = loadConfig(path.join(ROOT, 'config.yaml'));
    for (const key of ['max_words_per_run', 'max_examples_per_word', 'min_word_length', 'fetch_concurrency'] as const) {
      assert.ok(Number.isInteger(c[key]) && c[key] >= 1, `${key} = ${c[key]}`);
    }
    assert.ok(c.jisho_delay_ms >= 0);
  });

  it('names known providers', () => {
    const c = loadConfig(path.join(ROOT, 'config.yaml'));
    assert.ok(['auto', 'openai', 'elevenlabs', 'browser', 'disabled'].includes(c.tts.provider), c.tts.provider);
    assert.ok(['auto', 'ollama', 'google', 'disabled'].includes(c.translation.provider), c.translation.provider);
    if (c.publish) assert.ok(['s3', 'r2'].includes(c.publish.provider));
  });

  it('points the outputs at relative paths inside the project', () => {
    const c = loadConfig(path.join(ROOT, 'config.yaml'));
    for (const p of [c.output.json, c.output.html, c.output.markdown, c.database.path]) {
      assert.ok(!path.isAbsolute(p) && !p.startsWith('..'), p);
    }
  });
});

describe('shipped sources.yaml', () => {
  const feeds = () => loadSources(path.join(ROOT, 'sources.yaml'));

  it('has at least one enabled feed', () => {
    assert.ok(feeds().length >= 1);
  });

  it('gives every feed a name, an http(s) URL and a domain', () => {
    for (const f of feeds()) {
      assert.ok(f.name?.trim(), `name of ${f.url}`);
      assert.match(f.url, /^https?:\/\/\S+$/, f.name);
      assert.ok(f.domain?.trim(), `domain of ${f.name}`);
    }
  });

  it('has unique feed names, since --source selects by name', () => {
    const names = feeds().map(f => f.name);
    assert.deepEqual(names, [...new Set(names)]);
  });

  it('uses only known feed types, and maps every JSON feed', () => {
    for (const f of feeds()) {
      assert.ok([undefined, 'rss', 'json'].includes(f.type), `${f.name}: type ${f.type}`);
      if (f.type === 'json') assert.ok(f.json?.urlField, `${f.name} needs json.urlField`);
    }
  });
});
