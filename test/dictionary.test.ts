import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { jlptTagToLevel, levelMatches } from '../src/dictionary';
import type * as DictionaryModule from '../src/dictionary';
import type { JlptLevel, Level } from '../src/types';
import { captureConsole, drive, jsonResponse, mockFetch, textResponse, type Captured, type FetchCall } from './helpers';

// dictionary.ts keeps rate-limit and failure state at module level, so every
// test loads its own copy. Time is mocked so throttling and backoff are instant.
function freshDictionary(): typeof DictionaryModule {
  delete require.cache[require.resolve('../src/dictionary')];
  return require('../src/dictionary');
}

const entry = (over: Record<string, unknown> = {}) => ({
  slug: '猫', is_common: true, jlpt: ['jlpt-n5'],
  japanese: [{ word: '猫', reading: 'ねこ' }],
  senses: [{ english_definitions: ['cat', 'feline'], parts_of_speech: ['Noun'], tags: [], info: [] }],
  ...over,
});
const jisho = (...entries: unknown[]) => jsonResponse({ meta: { status: 200 }, data: entries });

let con: Captured;
let restoreFetch: (() => void) | undefined;
beforeEach(() => {
  con = captureConsole();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
});
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  mock.timers.reset();
  con.restore();
});

function install(handler: (call: FetchCall, n: number) => Response | Promise<Response>) {
  let n = 0;
  const m = mockFetch(call => handler(call, n++));
  restoreFetch = m.restore;
  return m;
}

describe('jlptTagToLevel', () => {
  const cases: Array<[string[], JlptLevel]> = [
    [['jlpt-n5'], 'N5'], [['jlpt-n4'], 'N4'], [['jlpt-n3'], 'N3'], [['jlpt-n2'], 'N2'], [['jlpt-n1'], 'N1'],
    [['JLPT-N3'], 'N3'],
    [['common', 'jlpt-n2'], 'N2'],
    [['jlpt-n5', 'jlpt-n1'], 'N5'],
    [[], 'unknown'],
    [['common', 'wanikani5'], 'unknown'],
    [['jlpt-n6'], 'unknown'],
  ];
  for (const [tags, expected] of cases) {
    it(`${JSON.stringify(tags)} → ${expected}`, () => assert.equal(jlptTagToLevel(tags), expected));
  }
});

describe('levelMatches', () => {
  const table: Record<Level, JlptLevel[]> = {
    beginner: ['N5', 'N4'],
    intermediate: ['N3'],
    advanced: ['N2', 'N1'],
    all: ['N5', 'N4', 'N3', 'N2', 'N1', 'unknown'],
  };
  const every: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1', 'unknown'];
  for (const [level, accepted] of Object.entries(table) as Array<[Level, JlptLevel[]]>) {
    it(`${level} accepts exactly ${accepted.join(', ')}`, () => {
      for (const jlpt of every) assert.equal(levelMatches(jlpt, level), accepted.includes(jlpt), `${jlpt} for ${level}`);
    });
  }
});

describe('lookupWord: results', () => {
  it('maps a Jisho entry', async () => {
    install(() => jisho(entry()));
    const { lookupWord } = freshDictionary();
    assert.deepEqual(await drive(lookupWord('猫', 0)), {
      word: '猫', reading: 'ねこ', pos: 'Noun', definition: 'cat', altDefinitions: ['feline'], jlptLevel: 'N5',
    });
  });

  it('queries Jisho with the encoded keyword and an explicit User-Agent', async () => {
    const m = install(() => jisho(entry()));
    const { lookupWord } = freshDictionary();
    await drive(lookupWord('食べる', 0));
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent('食べる')}`);
    const headers = m.calls[0].init?.headers as Record<string, string>;
    assert.match(headers['User-Agent'], /^KotobaNoSekai\//);
    assert.equal(headers['Accept'], 'application/json');
    assert.ok(m.calls[0].init?.signal, 'has a timeout signal');
  });

  it('prefers an exact match over the first result', async () => {
    install(() => jisho(
      entry({ japanese: [{ word: '猫舌', reading: 'ねこじた' }] }),
      entry({ japanese: [{ word: '猫', reading: 'ねこ' }] }),
    ));
    const { lookupWord } = freshDictionary();
    assert.equal((await drive(lookupWord('猫', 0)))?.word, '猫');
  });

  it('matches on reading too', async () => {
    install(() => jisho(
      entry({ japanese: [{ word: '子猫', reading: 'こねこ' }] }),
      entry({ japanese: [{ word: '猫', reading: 'ねこ' }] }),
    ));
    const { lookupWord } = freshDictionary();
    assert.equal((await drive(lookupWord('ねこ', 0)))?.word, '猫');
  });

  it('falls back to the first result when nothing matches exactly', async () => {
    install(() => jisho(entry({ japanese: [{ word: '子猫', reading: 'こねこ' }] }), entry()));
    const { lookupWord } = freshDictionary();
    assert.equal((await drive(lookupWord('ネコ', 0)))?.word, '子猫');
  });

  it('uses the searched word for a kana-only entry', async () => {
    install(() => jisho(entry({ japanese: [{ reading: 'ねこ' }] })));
    const { lookupWord } = freshDictionary();
    const r = await drive(lookupWord('ねこ', 0));
    assert.equal(r?.word, 'ねこ');
    assert.equal(r?.reading, 'ねこ');
  });

  it('defaults the part of speech and definition', async () => {
    install(() => jisho(entry({ senses: [{ english_definitions: [], parts_of_speech: [], tags: [], info: [] }] })));
    const { lookupWord } = freshDictionary();
    const r = await drive(lookupWord('猫', 0));
    assert.equal(r?.pos, 'Unknown');
    assert.equal(r?.definition, '');
    assert.deepEqual(r?.altDefinitions, []);
  });

  it('reports unknown JLPT level when untagged', async () => {
    install(() => jisho(entry({ jlpt: [] })));
    const { lookupWord } = freshDictionary();
    assert.equal((await drive(lookupWord('猫', 0)))?.jlptLevel, 'unknown');
  });

  it('returns null for no results, a missing data field, or no senses', async () => {
    const { lookupWord } = freshDictionary();
    install(() => jisho());
    assert.equal(await drive(lookupWord('a', 0)), null);
    restoreFetch!();
    install(() => jsonResponse({ meta: { status: 200 } }));
    assert.equal(await drive(lookupWord('b', 0)), null);
    restoreFetch!();
    install(() => jisho(entry({ senses: [] })));
    assert.equal(await drive(lookupWord('c', 0)), null);
    assert.deepEqual(con.warn, [], 'empty results are not failures');
  });
});

// The mocked clock moves in 1ms steps, so an observed request time can be 1ms off.
const SLACK = 1;

describe('lookupWord: throttling', () => {
  async function fetchTimes(delays: number[]): Promise<number[]> {
    const times: number[] = [];
    install(() => { times.push(Date.now()); return jisho(entry()); });
    const { lookupWord } = freshDictionary();
    for (const d of delays) await drive(lookupWord('猫', d));
    return times;
  }

  it('does not delay the first request', async () => {
    assert.ok((await fetchTimes([0]))[0] <= SLACK);
  });

  it('spaces requests at least 1250ms apart however low the delay is set', async () => {
    const t = await fetchTimes([0, 0, 100]);
    assert.ok(t[1] - t[0] >= 1250 - SLACK, `gap ${t[1] - t[0]}`);
    assert.ok(t[2] - t[1] >= 1250 - SLACK, `gap ${t[2] - t[1]}`);
  });

  it('honours a longer configured delay', async () => {
    const t = await fetchTimes([5000, 5000]);
    assert.ok(t[1] - t[0] >= 5000 - SLACK, `gap ${t[1] - t[0]}`);
  });

  it('reserves a distinct slot for concurrent callers', async () => {
    const times: number[] = [];
    install(() => { times.push(Date.now()); return jisho(entry()); });
    const { lookupWord } = freshDictionary();
    await drive(Promise.all([lookupWord('a', 0), lookupWord('b', 0), lookupWord('c', 0)]));
    assert.equal(times.length, 3);
    assert.ok(times[1] - times[0] >= 1250 - SLACK);
    assert.ok(times[2] - times[1] >= 1250 - SLACK);
  });
});

describe('lookupWord: rate limiting (429)', () => {
  it('retries after Retry-After and then succeeds', async () => {
    const times: number[] = [];
    install((_c, n) => { times.push(Date.now()); return n === 0 ? textResponse('slow down', 429, { 'retry-after': '20' }) : jisho(entry()); });
    const { lookupWord } = freshDictionary();
    const r = await drive(lookupWord('猫', 0));
    assert.equal(r?.word, '猫');
    assert.equal(times.length, 2);
    assert.ok(times[1] - times[0] >= 20_000 - SLACK, `waited ${times[1] - times[0]}`);
    assert.match(con.warn.join('\n'), /rate limit hit \(429\).*backing off 20s/);
  });

  it('backs off 10s, then 20s, without Retry-After', async () => {
    const times: number[] = [];
    install((_c, n) => { times.push(Date.now()); return n < 2 ? textResponse('', 429) : jisho(entry()); });
    const { lookupWord } = freshDictionary();
    await drive(lookupWord('猫', 0));
    assert.equal(times.length, 3);
    assert.ok(times[1] - times[0] >= 10_000 - SLACK);
    assert.ok(times[2] - times[1] >= 20_000 - SLACK);
  });

  it('caps the wait at 60s', async () => {
    const times: number[] = [];
    install((_c, n) => { times.push(Date.now()); return n === 0 ? textResponse('', 429, { 'retry-after': '3600' }) : jisho(entry()); });
    const { lookupWord } = freshDictionary();
    await drive(lookupWord('猫', 0));
    assert.ok(times[1] - times[0] >= 60_000 - SLACK);
    assert.ok(times[1] - times[0] < 120_000, `waited ${times[1] - times[0]}`);
  });

  it('holds back a caller that arrives during the wait', async () => {
    const times: number[] = [];
    install((_c, n) => {
      times.push(Date.now());
      return n === 0 ? textResponse('', 429, { 'retry-after': '30' }) : jisho(entry());
    });
    const { lookupWord } = freshDictionary();
    const first = lookupWord('a', 0);
    while (times.length === 0) { await new Promise(r => setImmediate(r)); mock.timers.tick(1); }
    await new Promise(r => setImmediate(r)); // let the 429 be processed
    const second = lookupWord('b', 0);
    await drive(Promise.all([first, second]));
    assert.equal(times.length, 3);
    // 'b' is not sent until the 30s wait is over (a's retry is also queued behind it).
    assert.ok(times[1] - times[0] >= 30_000 - SLACK, `second request at +${times[1] - times[0]}`);
    assert.ok(times[2] - times[0] >= 30_000 - SLACK, `third request at +${times[2] - times[0]}`);
  });

  it('holds back a caller that reserved its slot before the 429 arrived', async () => {
    const sent: Array<[string, number]> = [];
    install((c, n) => {
      sent.push([decodeURIComponent(c.url.split('=')[1]), Date.now()]);
      return n === 0 ? textResponse('', 429, { 'retry-after': '30' }) : jisho(entry());
    });
    const { lookupWord } = freshDictionary();
    // Both reserve a slot up front: 'a' at 0, 'b' at 1.25s. 'a' is then rate limited.
    await drive(Promise.all([lookupWord('a', 0), lookupWord('b', 0)]));
    assert.equal(sent.length, 3);
    const [first, ...rest] = sent;
    assert.equal(first[0], 'a');
    for (const [word, at] of rest) assert.ok(at - first[1] >= 30_000 - SLACK, `${word} sent at +${at - first[1]}`);
    const times = rest.map(([, at]) => at).sort((x, y) => x - y);
    assert.ok(times[1] - times[0] >= 1250 - SLACK, 'still spaced apart after the wait');
  });

  it('holds back several queued callers, one slot apart', async () => {
    const times: number[] = [];
    install((_c, n) => { times.push(Date.now()); return n === 0 ? textResponse('', 429, { 'retry-after': '10' }) : jisho(entry()); });
    const { lookupWord } = freshDictionary();
    await drive(Promise.all(['a', 'b', 'c', 'd'].map(w => lookupWord(w, 0))));
    assert.equal(times.length, 5, 'four lookups and one retry');
    for (const t of times.slice(1)) assert.ok(t - times[0] >= 10_000 - SLACK, `sent at +${t - times[0]}`);
    const rest = times.slice(1).sort((x, y) => x - y);
    for (let i = 1; i < rest.length; i++) assert.ok(rest[i] - rest[i - 1] >= 1250 - SLACK, `gap ${rest[i] - rest[i - 1]}`);
  });

  it('does not delay a retry that no one queued behind', async () => {
    const times: number[] = [];
    install((_c, n) => { times.push(Date.now()); return n === 0 ? textResponse('', 429, { 'retry-after': '10' }) : jisho(entry()); });
    const { lookupWord } = freshDictionary();
    await drive(lookupWord('a', 0));
    assert.ok(times[1] - times[0] >= 10_000 - SLACK);
    assert.ok(times[1] - times[0] < 10_000 + 100, `waited ${times[1] - times[0]}`);
  });

  it('gives up after three retries and counts a failure', async () => {
    const m = install(() => textResponse('', 429, { 'retry-after': '1' }));
    const { lookupWord } = freshDictionary();
    assert.equal(await drive(lookupWord('猫', 0)), null);
    assert.equal(m.calls.length, 4, 'first try plus three retries');
    assert.match(con.warn.at(-1) ?? '', /Jisho HTTP 429/);
  });
});

describe('lookupWord: failures', () => {
  it('returns null and warns on an HTTP error', async () => {
    install(() => textResponse('boom', 503));
    const { lookupWord } = freshDictionary();
    assert.equal(await drive(lookupWord('猫', 0)), null);
    assert.match(con.warn.join('\n'), /Jisho HTTP 503 for "猫"/);
  });

  it('returns null and warns on a network error', async () => {
    install(() => { throw new Error('ECONNRESET'); });
    const { lookupWord } = freshDictionary();
    assert.equal(await drive(lookupWord('猫', 0)), null);
    assert.match(con.warn.join('\n'), /lookup failed for "猫": ECONNRESET/);
  });

  it('returns null and warns on unreadable JSON', async () => {
    install(() => textResponse('<html>blocked</html>'));
    const { lookupWord } = freshDictionary();
    assert.equal(await drive(lookupWord('猫', 0)), null);
    assert.match(con.warn.join('\n'), /unreadable JSON/);
  });

  it('aborts the run after five failures in a row, and stays aborted', async () => {
    const m = install(() => textResponse('', 500));
    const { lookupWord, JishoUnavailableError } = freshDictionary();
    for (let i = 0; i < 4; i++) assert.equal(await drive(lookupWord(`w${i}`, 0)), null);
    await assert.rejects(drive(lookupWord('w4', 0)), (e: Error) => e instanceof JishoUnavailableError && /5 in a row/.test(e.message));
    const calls = m.calls.length;
    await assert.rejects(drive(lookupWord('again', 0)), JishoUnavailableError);
    assert.equal(m.calls.length, calls, 'no further requests once aborted');
  });

  it('a success resets the consecutive count', async () => {
    let fail = true;
    const m = install(() => (fail ? textResponse('', 500) : jisho(entry())));
    const { lookupWord } = freshDictionary();
    for (let i = 0; i < 4; i++) await drive(lookupWord(`f${i}`, 0));
    fail = false;
    assert.ok(await drive(lookupWord('ok', 0)));
    fail = true;
    for (let i = 0; i < 4; i++) assert.equal(await drive(lookupWord(`g${i}`, 0)), null);
    assert.equal(m.calls.length, 9);
  });

  it('aborts after twenty failures in total even when interleaved with successes', async () => {
    let fail = true;
    install(() => (fail ? textResponse('', 500) : jisho(entry())));
    const { lookupWord, JishoUnavailableError } = freshDictionary();
    let thrown: unknown;
    for (let i = 0; i < 60 && !thrown; i++) {
      fail = i % 3 !== 2; // two failures, then a success
      try { await drive(lookupWord(`w${i}`, 0)); } catch (e) { thrown = e; }
    }
    assert.ok(thrown instanceof JishoUnavailableError);
    assert.match((thrown as Error).message, /20 this run/);
  });
});

describe('createSerialLookup', () => {
  it('runs lookups one at a time, in order', async () => {
    let inFlight = 0, maxInFlight = 0;
    const order: string[] = [];
    install(async c => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(decodeURIComponent(c.url.split('=')[1]));
      await new Promise(resolve => setImmediate(resolve));
      inFlight--;
      return jisho(entry());
    });
    const { createSerialLookup } = freshDictionary();
    const lookup = createSerialLookup(0);
    const results = await drive(Promise.all(['a', 'b', 'c', 'd'].map(lookup)));
    assert.equal(results.length, 4);
    assert.equal(maxInFlight, 1);
    assert.deepEqual(order, ['a', 'b', 'c', 'd']);
  });

  it('returns each caller its own result', async () => {
    install(c => {
      const kw = decodeURIComponent(c.url.split('=')[1]);
      return jisho(entry({ japanese: [{ word: kw, reading: kw }] }));
    });
    const { createSerialLookup } = freshDictionary();
    const lookup = createSerialLookup(0);
    const [a, b] = await drive(Promise.all([lookup('猫'), lookup('犬')]));
    assert.equal(a?.word, '猫');
    assert.equal(b?.word, '犬');
  });

  it('rejects queued lookups once Jisho is declared unavailable', async () => {
    install(() => textResponse('', 500));
    const { createSerialLookup, JishoUnavailableError } = freshDictionary();
    const lookup = createSerialLookup(0);
    const settled = await drive(Promise.allSettled(Array.from({ length: 7 }, (_, i) => lookup(`w${i}`))));
    assert.deepEqual(settled.slice(0, 4).map(s => s.status), Array(4).fill('fulfilled'));
    for (const s of settled.slice(4)) {
      assert.equal(s.status, 'rejected');
      assert.ok((s as PromiseRejectedResult).reason instanceof JishoUnavailableError);
    }
  });
});
