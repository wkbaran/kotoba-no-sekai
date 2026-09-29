import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { markTranslation, resolveTranslationProvider, translateSentence } from '../src/translation';
import type { AppConfig, TranslationProvider } from '../src/types';
import { captureConsole, drive, jsonResponse, makeConfig, mockFetch, setEnv, textResponse, type Captured, type FetchCall } from './helpers';

let con: Captured;
let restoreEnv: () => void;
let restoreFetch: (() => void) | undefined;
beforeEach(() => { con = captureConsole(); restoreEnv = setEnv(); });
afterEach(() => { restoreFetch?.(); restoreFetch = undefined; mock.timers.reset(); restoreEnv(); con.restore(); });

const config = (provider: TranslationProvider): AppConfig => {
  const c = makeConfig('/unused');
  c.translation.provider = provider;
  return c;
};

function install(handler: (call: FetchCall, n: number) => Response | Promise<Response>) {
  let n = 0;
  const m = mockFetch(call => handler(call, n++));
  restoreFetch = m.restore;
  return m;
}

const isTags = (c: FetchCall) => c.url.endsWith('/api/tags');

describe('resolveTranslationProvider', () => {
  it('honours "disabled" without any request', async () => {
    const m = install(() => textResponse('', 200));
    assert.equal(await resolveTranslationProvider(config('disabled')), 'disabled');
    assert.equal(m.calls.length, 0);
  });

  describe('ollama', () => {
    it('is used when reachable', async () => {
      const m = install(() => jsonResponse({ models: [] }));
      assert.equal(await resolveTranslationProvider(config('ollama')), 'ollama');
      assert.equal(m.calls[0].url, 'http://ollama.test:11434/api/tags');
      assert.ok(m.calls[0].init?.signal, 'probe has a timeout');
    });

    it('disables translation, with a warning, when unreachable', async () => {
      install(() => { throw new Error('ECONNREFUSED'); });
      assert.equal(await resolveTranslationProvider(config('ollama')), 'disabled');
      assert.match(con.warn.join('\n'), /Ollama is not reachable/);
    });

    it('treats an HTTP error as unreachable', async () => {
      install(() => textResponse('', 502));
      assert.equal(await resolveTranslationProvider(config('ollama')), 'disabled');
    });

    it('does not fall back to Google', async () => {
      restoreEnv(); restoreEnv = setEnv({ GOOGLE_API_KEY: 'g' });
      install(() => { throw new Error('down'); });
      assert.equal(await resolveTranslationProvider(config('ollama')), 'disabled');
    });

    it('sends the API key as a bearer token when configured', async () => {
      restoreEnv(); restoreEnv = setEnv({ OLLAMA_API_KEY: '  secret  ' });
      const m = install(() => jsonResponse({}));
      await resolveTranslationProvider(config('ollama'));
      assert.equal((m.calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer secret');
    });

    it('sends no Authorization header without a key', async () => {
      const m = install(() => jsonResponse({}));
      await resolveTranslationProvider(config('ollama'));
      assert.equal((m.calls[0].init?.headers as Record<string, string>).Authorization, undefined);
    });
  });

  describe('google', () => {
    it('needs GOOGLE_API_KEY', async () => {
      const m = install(() => textResponse(''));
      assert.equal(await resolveTranslationProvider(config('google')), 'disabled');
      assert.match(con.warn.join('\n'), /GOOGLE_API_KEY is not set/);
      assert.equal(m.calls.length, 0);
    });

    it('is used when the key is set, without probing Ollama', async () => {
      restoreEnv(); restoreEnv = setEnv({ GOOGLE_API_KEY: 'g' });
      const m = install(() => textResponse(''));
      assert.equal(await resolveTranslationProvider(config('google')), 'google');
      assert.equal(m.calls.length, 0);
    });
  });

  describe('auto', () => {
    it('prefers Ollama', async () => {
      restoreEnv(); restoreEnv = setEnv({ GOOGLE_API_KEY: 'g' });
      install(() => jsonResponse({}));
      assert.equal(await resolveTranslationProvider(config('auto')), 'ollama');
      assert.match(con.log.join('\n'), /Using Ollama \(test-model\)/);
    });

    it('falls back to Google when Ollama is down', async () => {
      restoreEnv(); restoreEnv = setEnv({ GOOGLE_API_KEY: 'g' });
      install(() => { throw new Error('down'); });
      assert.equal(await resolveTranslationProvider(config('auto')), 'google');
      assert.match(con.log.join('\n'), /Ollama unreachable — using Google/);
    });

    it('is disabled when neither is available', async () => {
      install(() => { throw new Error('down'); });
      assert.equal(await resolveTranslationProvider(config('auto')), 'disabled');
      assert.match(con.log.join('\n'), /No translation provider available/);
    });
  });
});

describe('translateSentence: dispatch', () => {
  it('returns null for a disabled provider without any request', async () => {
    const m = install(() => textResponse(''));
    assert.equal(await translateSentence('猫', 'disabled', config('auto')), null);
    assert.equal(m.calls.length, 0);
  });

  it('returns null for an unrecognised provider', async () => {
    const m = install(() => textResponse(''));
    assert.equal(await translateSentence('猫', 'deepl' as never, config('auto')), null);
    assert.equal(m.calls.length, 0);
  });
});

describe('translateSentence: Ollama', () => {
  const ok = (response: string) => jsonResponse({ response });
  const translate = (s = '猫が好きです。') => drive(translateSentence(s, 'ollama', config('ollama')));

  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });

  it('posts the prompt to /api/generate and returns the trimmed answer', async () => {
    const m = install(() => ok('  I like cats.\n'));
    assert.equal(await translate('猫が好きです。'), 'I like cats.');
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, 'http://ollama.test:11434/api/generate');
    assert.equal(m.calls[0].init?.method, 'POST');
    const body = m.calls[0].body as { model: string; prompt: string; stream: boolean };
    assert.equal(body.model, 'test-model');
    assert.equal(body.stream, false);
    assert.match(body.prompt, /Translate the following Japanese sentence into natural English/);
    assert.ok(body.prompt.endsWith('\n\n猫が好きです。'), 'sentence is last');
    assert.ok(m.calls[0].init?.signal, 'has a timeout');
  });

  it('sends the API key when configured', async () => {
    restoreEnv(); restoreEnv = setEnv({ OLLAMA_API_KEY: 'secret' });
    const m = install(() => ok('x'));
    await translate();
    assert.equal((m.calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer secret');
    assert.equal((m.calls[0].init?.headers as Record<string, string>)['Content-Type'], 'application/json');
  });

  it('returns null when the response has no text', async () => {
    install(() => jsonResponse({}));
    assert.equal(await translate(), null);
  });

  it('does not retry an error reported in the body (e.g. unknown model)', async () => {
    const m = install(() => jsonResponse({ error: 'model "x" not found' }));
    assert.equal(await translate(), null);
    assert.equal(m.calls.length, 1);
    assert.match(con.warn.join('\n'), /error: model "x" not found/);
  });

  it('does not retry a client error', async () => {
    for (const status of [400, 401, 404]) {
      const m = install(() => textResponse('bad', status));
      assert.equal(await translate(), null, String(status));
      assert.equal(m.calls.length, 1, String(status));
      restoreFetch!();
    }
    assert.match(con.warn.join('\n'), /HTTP 404: bad/);
  });

  it('retries a busy server and succeeds', async () => {
    const m = install((_c, n) => (n < 2 ? textResponse('busy', 503) : ok('done')));
    assert.equal(await translate(), 'done');
    assert.equal(m.calls.length, 3);
    assert.match(con.warn[0], /HTTP 503: busy \(attempt 1\/3\), retrying in 5s/);
    assert.match(con.warn[1], /attempt 2\/3\), retrying in 10s/);
  });

  it('retries a 429', async () => {
    const m = install((_c, n) => (n === 0 ? textResponse('', 429) : ok('done')));
    assert.equal(await translate(), 'done');
    assert.equal(m.calls.length, 2);
  });

  it('retries a network error or timeout', async () => {
    const m = install((_c, n) => { if (n === 0) throw new Error('The operation was aborted due to timeout'); return ok('done'); });
    assert.equal(await translate(), 'done');
    assert.equal(m.calls.length, 2);
    assert.match(con.warn[0], /request failed: The operation was aborted due to timeout/);
  });

  it('waits 5s then 10s between attempts', async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const times: number[] = [];
    install(() => { times.push(Date.now()); return textResponse('busy', 500); });
    await translate();
    assert.equal(times.length, 3);
    assert.ok(times[1] - times[0] >= 5000 - 1 && times[1] - times[0] < 6000, `first wait ${times[1] - times[0]}`);
    assert.ok(times[2] - times[1] >= 10_000 - 1 && times[2] - times[1] < 11_000, `second wait ${times[2] - times[1]}`);
  });

  it('gives up after three attempts', async () => {
    const m = install(() => textResponse('busy', 500));
    assert.equal(await translate(), null);
    assert.equal(m.calls.length, 3);
    assert.equal(con.warn.length, 3, 'two retry notices and a final failure');
    assert.ok(!/retrying/.test(con.warn[2]));
    assert.match(con.warn[2], /Ollama HTTP 500: busy/);
  });

  it('truncates a long error body in the warning', async () => {
    install(() => textResponse('x'.repeat(1000), 400));
    await translate();
    assert.ok(con.warn[0].length < 300);
  });
});

describe('translateSentence: Google', () => {
  const translate = (s = '猫が好きです。') => translateSentence(s, 'google', config('google'));

  it('returns null without a key, without a request', async () => {
    const m = install(() => textResponse(''));
    assert.equal(await translate(), null);
    assert.equal(m.calls.length, 0);
  });

  it('posts to the v2 API and returns the trimmed translation', async () => {
    restoreEnv(); restoreEnv = setEnv({ GOOGLE_API_KEY: 'abc' });
    const m = install(() => jsonResponse({ data: { translations: [{ translatedText: ' I like cats. ' }] } }));
    assert.equal(await translate('猫が好きです。'), 'I like cats.');
    assert.equal(m.calls[0].url, 'https://translation.googleapis.com/language/translate/v2?key=abc');
    assert.deepEqual(m.calls[0].body, { q: '猫が好きです。', source: 'ja', target: 'en', format: 'text' });
  });

  it('returns null, with a warning, on an HTTP error', async () => {
    restoreEnv(); restoreEnv = setEnv({ GOOGLE_API_KEY: 'abc' });
    install(() => textResponse('quota exceeded', 403));
    assert.equal(await translate(), null);
    assert.match(con.warn.join('\n'), /Google HTTP 403: quota exceeded/);
  });

  it('returns null, with a warning, on a network error', async () => {
    restoreEnv(); restoreEnv = setEnv({ GOOGLE_API_KEY: 'abc' });
    install(() => { throw new Error('ENOTFOUND'); });
    assert.equal(await translate(), null);
    assert.match(con.warn.join('\n'), /Google request failed: ENOTFOUND/);
  });

  it('returns null when the response has no translations', async () => {
    restoreEnv(); restoreEnv = setEnv({ GOOGLE_API_KEY: 'abc' });
    install(() => jsonResponse({ data: {} }));
    assert.equal(await translate(), null);
    restoreFetch!();
    install(() => jsonResponse({ data: { translations: [] } }));
    assert.equal(await translate(), null);
  });
});

describe('markTranslation', () => {
  it('marks the keyword from the definition', () => {
    assert.equal(markTranslation('I eat rice every day.', 'to eat', []), 'I <mark>eat</mark> rice every day.');
  });

  it('strips a leading "to "', () => {
    assert.equal(markTranslation('She wants to swim.', 'to swim', []), 'She wants to <mark>swim</mark>.');
  });

  it('uses only the first phrase before ; , / or (', () => {
    assert.equal(markTranslation('A big dog ran.', 'big dog; large dog', []), 'A <mark>big dog</mark> ran.');
    assert.equal(markTranslation('A big dog ran.', 'big dog, large dog', []), 'A <mark>big dog</mark> ran.');
    assert.equal(markTranslation('A big dog ran.', 'big dog/large dog', []), 'A <mark>big dog</mark> ran.');
    assert.equal(markTranslation('A big dog ran.', 'big dog (animal)', []), 'A <mark>big dog</mark> ran.');
  });

  it('matches case-insensitively and keeps the text as written', () => {
    assert.equal(markTranslation('Eat well.', 'to eat', []), '<mark>Eat</mark> well.');
  });

  it('marks every occurrence', () => {
    assert.equal(markTranslation('cat and cat', 'cat', []), '<mark>cat</mark> and <mark>cat</mark>');
  });

  it('matches inflected forms by prefix', () => {
    assert.equal(markTranslation('He is eating now.', 'to eat', []), 'He is <mark>eat</mark>ing now.');
  });

  it('falls back to the first two alternative definitions', () => {
    assert.equal(markTranslation('He dines out.', 'to eat', ['to dine', 'to feed']), 'He <mark>dine</mark>s out.');
    assert.equal(markTranslation('He feeds them.', 'to eat', ['to dine', 'to feed']), 'He <mark>feed</mark>s them.');
    assert.equal(markTranslation('He gorges.', 'to eat', ['to dine', 'to feed', 'to gorge']), 'He gorges.', 'third alternative is ignored');
  });

  it('prefers the primary definition over the alternatives', () => {
    assert.equal(markTranslation('He can eat and dine.', 'to eat', ['to dine']), 'He can <mark>eat</mark> and dine.');
  });

  it('ignores keywords of two characters or fewer', () => {
    assert.equal(markTranslation('I go home.', 'to go', []), 'I go home.');
    assert.equal(markTranslation('I go home.', 'go', []), 'I go home.');
  });

  it('returns the escaped text when nothing matches', () => {
    assert.equal(markTranslation('Hello there.', 'to eat', ['to drink']), 'Hello there.');
    assert.equal(markTranslation('Hello there.', '', []), 'Hello there.');
  });

  it('escapes HTML in the translation', () => {
    assert.equal(markTranslation('<script>alert("x")</script> & \'y\'', 'to eat', []), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
    assert.equal(markTranslation('<b>I eat</b>', 'to eat', []), '&lt;b&gt;I <mark>eat</mark>&lt;/b&gt;');
  });

  it('treats regex characters in the keyword literally', () => {
    assert.equal(markTranslation('I like C++ a lot.', 'C++', []), 'I like <mark>C++</mark> a lot.');
    assert.equal(markTranslation('Is it a.b? yes', 'a.b?', []), 'Is it <mark>a.b?</mark> yes');
    assert.equal(markTranslation('axb', 'a.b', []), 'axb');
  });

  it('handles an empty translation', () => {
    assert.equal(markTranslation('', 'to eat', []), '');
  });
});
