import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AppConfig, ExampleSentence, WordRecord } from '../src/types';
import type { KuromojiTokenizer } from '../src/tokenizer';

// ── Environment ───────────────────────────────────────────

/** Variables the code under test reads; cleared so a developer's shell can't leak into a test. */
const ENV_KEYS = [
  'OLLAMA_HOST', 'OLLAMA_MODEL', 'OLLAMA_API_KEY',
  'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY',
  'S3_BUCKET', 'R2_BUCKET', 'AWS_REGION',
  'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'CLOUDFRONT_DISTRIBUTION_ID',
];

/**
 * Clear the env vars the app reads, apply `vars`, and return a restore function.
 * Call the restore function from `afterEach`.
 */
export function setEnv(vars: Record<string, string | undefined> = {}): () => void {
  const saved = new Map<string, string | undefined>();
  for (const k of [...ENV_KEYS, ...Object.keys(vars)]) {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  return () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

// ── Timers ────────────────────────────────────────────────

/**
 * Await a promise while advancing a mocked clock (`mock.timers.enable(...)`) whenever it is
 * waiting on a timer. Steps are 1ms by default so observed times are precise.
 */
export async function drive<T>(promise: Promise<T>, stepMs = 1): Promise<T> {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; !settled; i++) {
    assert.ok(i < 500_000, 'promise never settled');
    await new Promise(resolve => setImmediate(resolve));
    if (!settled) mock.timers.tick(stepMs);
  }
  return promise;
}

// ── Filesystem ────────────────────────────────────────────

const tmpDirs: string[] = [];

export function tmpDir(prefix = 'kotoba-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

export function cleanupTmpDirs(): void {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function write(file: string, content: string | Buffer): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

export const read = (file: string) => fs.readFileSync(file, 'utf8');

// ── Console ───────────────────────────────────────────────

export interface Captured {
  log: string[];
  warn: string[];
  error: string[];
  restore: () => void;
}

/** Silence console output and record it. */
export function captureConsole(): Captured {
  const out: Captured = { log: [], warn: [], error: [], restore: () => {} };
  const fmt = (args: unknown[]) => args.map(String).join(' ');
  const log = mock.method(console, 'log', (...a: unknown[]) => { out.log.push(fmt(a)); });
  const warn = mock.method(console, 'warn', (...a: unknown[]) => { out.warn.push(fmt(a)); });
  const error = mock.method(console, 'error', (...a: unknown[]) => { out.error.push(fmt(a)); });
  out.restore = () => { log.mock.restore(); warn.mock.restore(); error.mock.restore(); };
  return out;
}

// ── fetch ─────────────────────────────────────────────────

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  body: unknown;
}

export type FetchHandler = (call: FetchCall) => Response | Promise<Response>;

/**
 * Replace global fetch. Returns the recorded calls and a restore function.
 * A handler that throws simulates a network failure.
 */
export function mockFetch(handler: FetchHandler): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* leave as text */ }
    }
    const call = { url, init, body };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export const jsonResponse = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

export const textResponse = (text: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(text, { status, headers });

// ── Local HTTP server ─────────────────────────────────────

export interface TestServer {
  url: string;
  hits: string[];
  close: () => Promise<void>;
}

export type Route = string | [status: number, body: string, contentType?: string];

/**
 * Serve fixed bodies by path. Unlisted paths are 404. A route may be a function of the
 * server's base URL, for feeds that link back to the server.
 */
export async function startServer(routes: Record<string, Route | ((base: string) => Route)>): Promise<TestServer> {
  const hits: string[] = [];
  let base = '';
  const server = http.createServer((req, res) => {
    const p = (req.url ?? '/').split('?')[0];
    hits.push(p);
    const entry = routes[p];
    if (entry === undefined) { res.statusCode = 404; res.end('not found'); return; }
    const route = typeof entry === 'function' ? entry(base) : entry;
    const [status, body, type] = typeof route === 'string' ? [200, route, undefined] : route;
    res.statusCode = status;
    res.setHeader('content-type', type ?? (body.trimStart().startsWith('<?xml') ? 'application/rss+xml' : 'text/html; charset=utf-8'));
    res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    hits,
    close: () => new Promise<void>(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

// ── Fixtures ──────────────────────────────────────────────

export function makeExample(overrides: Partial<ExampleSentence> = {}): ExampleSentence {
  return {
    markedHtml: '毎日ご飯を<mark>食べる</mark>のが好きです。',
    glossedHtml: '<ruby>毎日<rt>まいにち</rt></ruby>を<mark>食べる</mark>',
    plain: '毎日ご飯を食べるのが好きです。',
    sourceUrl: 'https://example.com/a#:~:text=%E9%A3%9F%E3%81%B9%E3%82%8B',
    articleText: '',
    ...overrides,
  };
}

export function makeRecord(overrides: Partial<WordRecord> = {}): WordRecord {
  return {
    word: '食べる',
    reading: 'たべる',
    pos: 'Ichidan verb',
    definition: 'to eat',
    altDefinitions: ['to live on'],
    examples: [makeExample()],
    sourceUrl: 'https://www3.nhk.or.jp/news/a.html',
    domain: 'news',
    jlptLevel: 'N5',
    date: '2026-09-01',
    ...overrides,
  };
}

/** A config that keeps everything inside `root` and turns off every network provider. */
export function makeConfig(root: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    level: 'all',
    max_words_per_run: 2,
    max_examples_per_word: 2,
    min_word_length: 2,
    jisho_delay_ms: 0,
    fetch_concurrency: 2,
    output: {
      json: path.join(root, 'data'),
      html: path.join(root, 'web'),
      markdown: path.join(root, 'web'),
    },
    database: { path: path.join(root, 'kotoba.db') },
    tts: {
      provider: 'disabled',
      openai: { voice: 'alloy', model: 'tts-1' },
      elevenlabs: { voice_id: 'voice', model_id: 'model' },
    },
    translation: {
      provider: 'disabled',
      ollama: { url: 'http://ollama.test:11434', model: 'test-model' },
      google: {},
    },
    ...overrides,
  };
}

/** Make the output dirs a config points at. */
export function makeOutputDirs(config: AppConfig): void {
  for (const d of [config.output.json, config.output.html, config.output.markdown, path.join(config.output.html, 'audio')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** Minimal tokenizer double: one token per character, or explicit tokens. */
export function fakeTokenizer(tokens?: Array<Partial<import('kuromoji').IpadicFeatures>>): KuromojiTokenizer {
  return {
    tokenize: (text: string) => {
      if (tokens) return tokens.map(t => ({ ...baseToken, ...t })) as never;
      return [...text].map(ch => ({ ...baseToken, surface_form: ch, reading: ch })) as never;
    },
  };
}

const baseToken = {
  word_id: 0, word_type: 'KNOWN', word_position: 0,
  surface_form: '', pos: '名詞', pos_detail_1: '一般', pos_detail_2: '*', pos_detail_3: '*',
  conjugated_type: '*', conjugated_form: '*', basic_form: '*', reading: '*', pronunciation: '*',
};
