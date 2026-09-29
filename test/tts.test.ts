import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { generateAudio, resolveProvider } from '../src/tts';
import type { AppConfig, TtsProvider } from '../src/types';
import {
  captureConsole, cleanupTmpDirs, makeConfig, makeExample, makeRecord, mockFetch, setEnv, textResponse, tmpDir,
  type Captured, type FetchCall,
} from './helpers';

let con: Captured;
let restoreEnv: () => void;
let restoreFetch: (() => void) | undefined;
beforeEach(() => { con = captureConsole(); restoreEnv = setEnv(); });
afterEach(() => { restoreFetch?.(); restoreFetch = undefined; restoreEnv(); con.restore(); cleanupTmpDirs(); });

const withProvider = (provider: TtsProvider, root = '/unused'): AppConfig => {
  const c = makeConfig(root);
  c.tts.provider = provider;
  return c;
};

const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
const audioResponse = () => new Response(AUDIO, { status: 200, headers: { 'content-type': 'audio/mpeg' } });

function install(handler: (call: FetchCall, n: number) => Response | Promise<Response>) {
  let n = 0;
  const m = mockFetch(call => handler(call, n++));
  restoreFetch = m.restore;
  return m;
}

describe('resolveProvider', () => {
  const keys = { ELEVENLABS_API_KEY: 'e', OPENAI_API_KEY: 'o' };
  const resolve = (provider: TtsProvider, env: Record<string, string> = {}) => {
    restoreEnv(); restoreEnv = setEnv(env);
    return resolveProvider(withProvider(provider));
  };

  it('"disabled" and "browser" never use a service', () => {
    assert.equal(resolve('disabled', keys), 'browser');
    assert.equal(resolve('browser', keys), 'browser');
  });

  it('"openai" needs OPENAI_API_KEY', () => {
    assert.equal(resolve('openai', { OPENAI_API_KEY: 'o' }), 'openai');
    assert.equal(resolve('openai', { ELEVENLABS_API_KEY: 'e' }), 'browser');
    assert.match(con.warn.join('\n'), /OPENAI_API_KEY is not set — falling back to browser/);
  });

  it('"elevenlabs" needs ELEVENLABS_API_KEY', () => {
    assert.equal(resolve('elevenlabs', { ELEVENLABS_API_KEY: 'e' }), 'elevenlabs');
    assert.equal(resolve('elevenlabs', { OPENAI_API_KEY: 'o' }), 'browser');
    assert.match(con.warn.join('\n'), /ELEVENLABS_API_KEY is not set/);
  });

  it('"auto" tries ElevenLabs, then OpenAI, then the browser', () => {
    assert.equal(resolve('auto', keys), 'elevenlabs');
    assert.equal(resolve('auto', { OPENAI_API_KEY: 'o' }), 'openai');
    assert.equal(resolve('auto'), 'browser');
    assert.deepEqual(con.warn, [], 'auto falls through quietly');
  });
});

describe('generateAudio: no audio', () => {
  it('returns null for the browser provider, without any request', async () => {
    const m = install(() => audioResponse());
    assert.equal(await generateAudio(makeRecord(), 0, withProvider('browser'), tmpDir(), 's'), null);
    assert.equal(m.calls.length, 0);
  });

  it('returns null when disabled, even with keys set', async () => {
    restoreEnv(); restoreEnv = setEnv({ OPENAI_API_KEY: 'o', ELEVENLABS_API_KEY: 'e' });
    const m = install(() => audioResponse());
    assert.equal(await generateAudio(makeRecord(), 0, withProvider('disabled'), tmpDir(), 's'), null);
    assert.equal(m.calls.length, 0);
  });

  it('returns null for "auto" with no keys', async () => {
    assert.equal(await generateAudio(makeRecord(), 0, withProvider('auto'), tmpDir(), 's'), null);
  });
});

describe('generateAudio: OpenAI', () => {
  let root: string;
  let config: AppConfig;
  beforeEach(() => {
    restoreEnv(); restoreEnv = setEnv({ OPENAI_API_KEY: 'sk-test' });
    root = tmpDir();
    fs.mkdirSync(path.join(root, 'audio'));
    config = withProvider('openai');
    config.tts.openai = { voice: 'nova', model: 'tts-1-hd' };
  });

  const record = () => makeRecord({
    reading: 'たべる',
    examples: [makeExample({ plain: '一つ目の文です。' }), makeExample({ plain: '二つ目の文です。' })],
  });

  it('writes three speeds for the word and for each example', async () => {
    install(() => audioResponse());
    const r = await generateAudio(record(), 3, config, root, '2026-09-01');
    assert.deepEqual(r, {
      provider: 'openai',
      wordAudioFile: 'audio/2026-09-01-3-word.mp3',
      wordAudioFileSlow: 'audio/2026-09-01-3-word-slow.mp3',
      wordAudioFileVslow: 'audio/2026-09-01-3-word-vslow.mp3',
      exampleAudioFiles: ['audio/2026-09-01-3-ex0.mp3', 'audio/2026-09-01-3-ex1.mp3'],
      exampleAudioFilesSlow: ['audio/2026-09-01-3-ex0-slow.mp3', 'audio/2026-09-01-3-ex1-slow.mp3'],
      exampleAudioFilesVslow: ['audio/2026-09-01-3-ex0-vslow.mp3', 'audio/2026-09-01-3-ex1-vslow.mp3'],
    });
    const files = fs.readdirSync(path.join(root, 'audio')).sort();
    assert.equal(files.length, 9);
    assert.deepEqual([...fs.readFileSync(path.join(root, 'audio', '2026-09-01-3-word.mp3'))], [...AUDIO]);
  });

  it('calls the OpenAI speech API with the configured voice and model', async () => {
    const m = install(() => audioResponse());
    await generateAudio(record(), 0, config, root, 's');
    assert.equal(m.calls.length, 9);
    assert.equal(m.calls[0].url, 'https://api.openai.com/v1/audio/speech');
    assert.equal((m.calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer sk-test');
    assert.deepEqual(m.calls[0].body, { model: 'tts-1-hd', voice: 'nova', input: 'たべる', response_format: 'mp3', speed: 1 });
  });

  it('speaks the reading for the word and the plain text for examples, at 1, 0.85 and 0.7', async () => {
    const m = install(() => audioResponse());
    await generateAudio(record(), 0, config, root, 's');
    const sent = m.calls.map(c => [(c.body as { input: string }).input, (c.body as { speed: number }).speed]);
    assert.deepEqual(sent, [
      ['たべる', 1], ['たべる', 0.85], ['たべる', 0.7],
      ['一つ目の文です。', 1], ['一つ目の文です。', 0.85], ['一つ目の文です。', 0.7],
      ['二つ目の文です。', 1], ['二つ目の文です。', 0.85], ['二つ目の文です。', 0.7],
    ]);
  });

  it('speaks the word itself when there is no reading', async () => {
    const m = install(() => audioResponse());
    await generateAudio(makeRecord({ reading: '', examples: [] }), 0, config, root, 's');
    assert.equal((m.calls[0].body as { input: string }).input, '食べる');
    assert.equal(m.calls.length, 3, 'word only, no examples');
  });

  it('returns null when the normal-speed word audio fails', async () => {
    install(() => textResponse('quota', 429));
    assert.equal(await generateAudio(record(), 0, config, root, 's'), null);
    assert.match(con.warn.join('\n'), /Failed "s-0-word\.mp3" at 1×: OpenAI TTS HTTP 429: quota/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'audio')), []);
  });

  it('keeps going when only a slower speed fails', async () => {
    install(c => ((c.body as { speed: number }).speed === 0.7 ? textResponse('no', 500) : audioResponse()));
    const r = await generateAudio(record(), 0, config, root, 's');
    assert.equal(r?.wordAudioFile, 'audio/s-0-word.mp3');
    assert.equal(r?.wordAudioFileSlow, 'audio/s-0-word-slow.mp3');
    assert.equal(r?.wordAudioFileVslow, undefined);
    assert.deepEqual(r?.exampleAudioFilesVslow, [undefined, undefined], 'a gap per example, not a shorter list');
    assert.equal(r?.exampleAudioFiles.length, 2);
  });

  it('survives a network error on an example', async () => {
    install(c => { if ((c.body as { input: string }).input === '一つ目の文です。') throw new Error('socket hang up'); return audioResponse(); });
    const r = await generateAudio(record(), 0, config, root, 's');
    assert.ok(r);
    assert.match(con.warn.join('\n'), /socket hang up/);
  });

  it('returns null, with a warning, when the audio directory is missing', async () => {
    install(() => audioResponse());
    assert.equal(await generateAudio(record(), 0, config, path.join(root, 'nowhere'), 's'), null);
    assert.match(con.warn.join('\n'), /Failed "s-0-word\.mp3"/);
  });

  // The pipeline attaches audio to examples by index, so a failure must leave a gap.
  it('keeps each example\'s audio aligned when an earlier one fails', async () => {
    install(c => {
      const { input, speed } = c.body as { input: string; speed: number };
      return input === '一つ目の文です。' && speed === 1 ? textResponse('no', 400) : audioResponse();
    });
    const r = await generateAudio(record(), 0, config, root, 's');
    assert.ok(r);
    assert.deepEqual(r.exampleAudioFiles, [undefined, 'audio/s-0-ex1.mp3']);
    assert.deepEqual(r.exampleAudioFilesSlow, ['audio/s-0-ex0-slow.mp3', 'audio/s-0-ex1-slow.mp3']);
  });

  it('leaves a gap in the slow list when only a slow file fails', async () => {
    install(c => {
      const { input, speed } = c.body as { input: string; speed: number };
      return input === '二つ目の文です。' && speed === 0.85 ? textResponse('no', 400) : audioResponse();
    });
    const r = await generateAudio(record(), 0, config, root, 's');
    assert.deepEqual(r?.exampleAudioFilesSlow, ['audio/s-0-ex0-slow.mp3', undefined]);
    assert.equal(r?.exampleAudioFiles.length, 2);
  });
});

describe('generateAudio: ElevenLabs', () => {
  let root: string;
  let config: AppConfig;
  beforeEach(() => {
    restoreEnv(); restoreEnv = setEnv({ ELEVENLABS_API_KEY: 'xi-test' });
    root = tmpDir();
    fs.mkdirSync(path.join(root, 'audio'));
    config = withProvider('elevenlabs');
    config.tts.elevenlabs = { voice_id: 'voice123', model_id: 'eleven_test' };
  });

  it('requests Japanese speech from the configured voice and model', async () => {
    const m = install(() => audioResponse());
    const r = await generateAudio(makeRecord({ examples: [] }), 1, config, root, 's');
    assert.equal(r?.provider, 'elevenlabs');
    assert.equal(r?.wordAudioFile, 'audio/s-1-word.mp3');
    assert.equal(m.calls.length, 3);
    const [call] = m.calls;
    assert.match(call.url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/voice123\?output_format=mp3_44100_128$/);
    assert.deepEqual(call.body, {
      text: 'たべる', model_id: 'eleven_test', language_code: 'ja',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 },
    });
    const speeds = m.calls.map(c => (c.body as { voice_settings: { speed: number } }).voice_settings.speed);
    assert.deepEqual(speeds, [1, 0.85, 0.7]);
  });

  it('writes the streamed audio to disk', async () => {
    install(() => audioResponse());
    await generateAudio(makeRecord({ examples: [] }), 0, config, root, 's');
    assert.deepEqual([...fs.readFileSync(path.join(root, 'audio', 's-0-word.mp3'))], [...AUDIO]);
  });

  it('returns null when the API rejects the request', async () => {
    install(() => new Response(JSON.stringify({ detail: { status: 'invalid_api_key' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    assert.equal(await generateAudio(makeRecord(), 0, config, root, 's'), null);
    assert.match(con.warn.join('\n'), /Failed "s-0-word\.mp3"/);
  });
});
