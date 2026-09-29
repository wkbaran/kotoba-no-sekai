import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  buildDiversifiedQueue, runPipeline, runSourcePipeline, runUrlPipeline, runWordPipeline,
} from '../src/pipeline';
import { WordDatabase } from '../src/db';
import { getTokenizer } from '../src/tokenizer';
import type { AppConfig, FeedSource } from '../src/types';
import {
  captureConsole, cleanupTmpDirs, drive, jsonResponse, makeConfig, makeOutputDirs, makeRecord, mockFetch, read, setEnv,
  textResponse, tmpDir, type Captured, type FetchCall,
} from './helpers';

// ── World: feeds, pages and Jisho, all served through a mocked fetch ──

interface Item { url: string; title?: string; date?: string; body?: string }
interface World {
  feeds: Record<string, Item[] | 'fail'>;
  pages: Record<string, string>;
  /** Words Jisho knows; anything else is "no results". Value overrides the entry. */
  jisho: Record<string, Partial<{ jlpt: string[]; pos: string; reading: string; word: string; def: string }>> | 'all' | 'down';
  ollama?: (sentence: string) => string;
  openai?: boolean;
}

const jishoEntry = (kw: string, o: Partial<{ jlpt: string[]; pos: string; reading: string; word: string; def: string }> = {}) => ({
  slug: kw, is_common: true, jlpt: o.jlpt ?? ['jlpt-n5'],
  japanese: [{ word: o.word ?? kw, reading: o.reading ?? 'よみ' }],
  senses: [{ english_definitions: [o.def ?? `meaning of ${kw}`, `alt of ${kw}`], parts_of_speech: [o.pos ?? 'Noun'], tags: [], info: [] }],
});

const inline = (text: string) => `<p>${text}</p>`;
const feedSource = (name: string, over: Partial<FeedSource> = {}): FeedSource => ({
  name, domain: `${name}-domain`, url: `http://feed.test/${name}.json`, enabled: true,
  type: 'json', json: { itemsPath: 'items', urlField: 'url', titleField: 'title', contentField: 'body', dateField: 'date' }, ...over,
});

let con: Captured;
let restoreEnv: () => void;
let restoreFetch: () => void;
let calls: FetchCall[];
let root: string;
let config: AppConfig;

function serve(world: World): void {
  const m = mockFetch(call => {
    const { url } = call;
    const feed = Object.entries(world.feeds).find(([u]) => url === `http://feed.test/${u}.json`);
    if (feed) return feed[1] === 'fail' ? textResponse('down', 500) : jsonResponse({ items: feed[1] });
    if (url in world.pages) return textResponse(world.pages[url]);
    if (url.startsWith('https://jisho.org/')) {
      if (world.jisho === 'down') return textResponse('blocked', 503);
      const kw = decodeURIComponent(url.split('keyword=')[1]);
      if (world.jisho !== 'all' && !(kw in world.jisho)) return jsonResponse({ meta: { status: 200 }, data: [] });
      return jsonResponse({ meta: { status: 200 }, data: [jishoEntry(kw, world.jisho === 'all' ? {} : world.jisho[kw])] });
    }
    if (world.ollama && url.endsWith('/api/tags')) return jsonResponse({ models: [] });
    if (world.ollama && url.endsWith('/api/generate')) return jsonResponse({ response: world.ollama((call.body as { prompt: string }).prompt.split('\n\n').pop()!) });
    if (world.openai && url === 'https://api.openai.com/v1/audio/speech') return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    return textResponse(`unexpected request: ${url}`, 404);
  });
  restoreFetch = m.restore;
  calls = m.calls;
}

const jishoCalls = () => calls.filter(c => c.url.startsWith('https://jisho.org/')).map(c => decodeURIComponent(c.url.split('keyword=')[1]));
const run = <T>(p: Promise<T>) => drive(p);
const readJson = (dir: string, file: string) => JSON.parse(read(path.join(dir, file)));
const seenWords = (): string[] => {
  const conn = new Database(config.database.path, { readonly: true });
  try { return (conn.prepare('SELECT word FROM seen_words ORDER BY word').all() as Array<{ word: string }>).map(r => r.word); } finally { conn.close(); }
};
const runLog = () => {
  const conn = new Database(config.database.path, { readonly: true });
  try { return conn.prepare('SELECT run_date, word_count, sources FROM run_log').all() as Array<{ run_date: string; word_count: number; sources: string }>; } finally { conn.close(); }
};

// Articles: each has one obvious vocabulary word (公園 / 図書館 / 学校 / 病院) near the front.
// Filler pads them past the 200-character threshold for using a feed's inline body, without
// repeating the lead sentences (which would give one word several identical examples).
const FILLER = 'この文章は記事を長くするための説明です。';
const ART = {
  park: '公園で子供たちが元気に遊んでいます。天気が良い日は特に人が多いです。',
  library: '図書館で静かに本を読んでいます。勉強するには最適な場所だと思います。',
  school: '学校で新しい友達ができました。毎日とても楽しく過ごしています。',
  hospital: '病院で医者の先生に相談しました。薬をもらって家に帰りました。',
  parkAgain: '昨日も公園へ行きました。ベンチに座って空を眺めていました。',
};
const article = (name: keyof typeof ART, i = 0): Item => ({ url: `http://news.test/${name}`, title: name, date: `2026-09-${String(20 - i).padStart(2, '0')}T00:00:00Z`, body: inline(ART[name] + FILLER.repeat(10)) });

before(async () => { await getTokenizer(); });
beforeEach(() => {
  con = captureConsole();
  restoreEnv = setEnv();
  root = tmpDir();
  config = makeConfig(root);
  makeOutputDirs(config);
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-09-15T12:00:00').getTime() });
});
afterEach(() => {
  restoreFetch?.();
  mock.timers.reset();
  restoreEnv();
  con.restore();
  cleanupTmpDirs();
});

describe('buildDiversifiedQueue', () => {
  const stubsFor = (feeds: Record<string, Item[] | 'fail'>) => { serve({ feeds, pages: {}, jisho: {} }); return buildDiversifiedQueue(Object.keys(feeds).map(n => feedSource(n))); };
  const at = (day: number): Item => ({ url: `http://x.test/${day}`, date: `2026-09-${String(day).padStart(2, '0')}T00:00:00Z` });
  const days = (q: Awaited<ReturnType<typeof buildDiversifiedQueue>>) => q.map(s => Number(s.url.split('/').pop()));

  it('interleaves the feeds round-robin, newest first within each', async () => {
    const q = await stubsFor({ a: [at(1), at(5), at(3)], b: [at(2), at(9)], c: [at(4)] });
    assert.deepEqual(days(q), [5, 9, 4, 3, 2, 1]);
    assert.deepEqual(q.map(s => s.feedName), ['a', 'b', 'c', 'a', 'b', 'a']);
  });

  it('does not let a big feed crowd out a small one', async () => {
    const q = await stubsFor({ big: [at(9), at(8), at(7), at(6), at(5)], small: [at(1)] });
    assert.deepEqual(q.slice(0, 2).map(s => s.feedName), ['big', 'small']);
  });

  it('puts undated items last within their feed, keeping their order', async () => {
    const q = await stubsFor({ a: [{ url: 'http://x.test/1' }, at(3), { url: 'http://x.test/2' }] });
    assert.deepEqual(days(q), [3, 1, 2]);
  });

  it('handles an empty feed, a failing feed and no feeds', async () => {
    assert.deepEqual(days(await stubsFor({ a: [], b: [at(1)], c: 'fail' })), [1]);
    assert.deepEqual(await buildDiversifiedQueue([]), []);
  });

  it('does not modify the stubs it is given', async () => {
    const q = await stubsFor({ a: [at(1)] });
    assert.deepEqual(Object.keys(q[0]).sort(), ['domain', 'feedName', 'inlineText', 'publishedAt', 'title', 'url']);
  });
});

describe('runPipeline', () => {
  const twoFeeds = () => ({
    news: [article('park', 0), article('library', 1)],
    blog: [article('school', 0), article('hospital', 1)],
  });

  it('collects the target number of words and writes every output', async () => {
    serve({ feeds: twoFeeds(), pages: {}, jisho: 'all' });
    const result = await run(runPipeline(config, [feedSource('news'), feedSource('blog')], '2026-09-15'));

    assert.equal(result.wordsCollected, 2);
    assert.equal(result.outputPaths.json, path.join(config.output.json, 'words-2026-09-15.json'));
    assert.equal(result.outputPaths.markdown, path.join(config.output.markdown, 'digest-2026-09-15.md'));
    assert.equal(result.outputPaths.html, path.join(config.output.html, 'digest-2026-09-15.html'));
    for (const f of [result.outputPaths.json, result.outputPaths.markdown, result.outputPaths.html]) assert.ok(fs.existsSync(f), f);
    for (const f of ['index.html', 'words.html', 'manifest.json']) assert.ok(fs.existsSync(path.join(config.output.html, f)), f);

    const json = readJson(config.output.json, 'words-2026-09-15.json');
    assert.equal(json.fullRecords.length, 2);
    assert.equal(json.ankiNotes.length, 2);
    assert.equal(json.reviewWord, undefined);
    for (const r of json.fullRecords) {
      assert.ok(r.word && r.reading === 'よみ' && r.jlptLevel === 'N5' && r.definition.startsWith('meaning of'));
      assert.equal(r.date, '2026-09-15');
      assert.ok(r.examples.length >= 1 && r.examples.length <= config.max_examples_per_word);
      for (const ex of r.examples) {
        assert.match(ex.markedHtml, /<mark>.+<\/mark>/);
        assert.ok(ex.plain.length > 0);
        assert.match(ex.sourceUrl, /^http:\/\/news\.test\/\w+#:~:text=/);
        assert.match(ex.glossedHtml, /<ruby/);
      }
    }
  });

  it('remembers the words and logs the run', async () => {
    serve({ feeds: twoFeeds(), pages: {}, jisho: 'all' });
    const result = await run(runPipeline(config, [feedSource('news'), feedSource('blog')], '2026-09-15'));
    const words = seenWords();
    assert.equal(words.length, result.wordsCollected);
    const log = runLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].run_date, '2026-09-15');
    assert.equal(log[0].word_count, 2);
    assert.match(log[0].sources, /^(news|blog)(, (news|blog))?$/);
  });

  it('never stops at more than max_words_per_run, however many workers race', async () => {
    config.max_words_per_run = 1;
    config.fetch_concurrency = 4;
    serve({ feeds: twoFeeds(), pages: {}, jisho: 'all' });
    const result = await run(runPipeline(config, [feedSource('news'), feedSource('blog')], '2026-09-15'));
    assert.equal(result.wordsCollected, 1);
    assert.equal(readJson(config.output.json, 'words-2026-09-15.json').fullRecords.length, 1);
    assert.equal(seenWords().length, 1);
  });

  it('does not offer a word it has already taught', async () => {
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: 'all' });
    config.max_words_per_run = 1;
    const first = await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    const taught = readJson(config.output.json, 'words-2026-09-15.json').fullRecords[0].word;
    assert.equal(first.wordsCollected, 1);

    restoreFetch();
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: 'all' });
    const second = await run(runPipeline(config, [feedSource('news')], '2026-09-16'));
    assert.equal(second.wordsCollected, 1);
    const next = readJson(config.output.json, 'words-2026-09-16.json').fullRecords[0].word;
    assert.notEqual(next, taught);
    assert.equal(seenWords().length, 2);
  });

  it('skips a candidate whose dictionary entry was already seen under another spelling', async () => {
    // Jisho maps every lookup to the same canonical word, so only the first can be taught.
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: { 公園: {}, 子供: { word: '公園', reading: 'よみ' }, 元気: { word: '公園', reading: 'よみ' }, 天気: { word: '公園', reading: 'よみ' }, 遊ぶ: { word: '公園', reading: 'よみ' }, 特に: { word: '公園', reading: 'よみ' } } });
    config.max_words_per_run = 3;
    const result = await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 1);
    assert.deepEqual(seenWords(), ['公園']);
  });

  it('asks Jisho about each base form at most once per run', async () => {
    serve({ feeds: { a: [article('park')], b: [article('parkAgain')] }, pages: {}, jisho: {} });
    await run(runPipeline(config, [feedSource('a'), feedSource('b')], '2026-09-15'));
    const asked = jishoCalls();
    assert.equal(new Set(asked).size, asked.length, `repeated: ${asked}`);
    assert.ok(asked.includes('公園'));
  });

  it('ignores words outside the configured level', async () => {
    config.level = 'beginner';
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: 'all' });
    let result = await run(runPipeline({ ...config, level: 'advanced' }, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 0, 'N5 words are not advanced');

    result = await run(runPipeline({ ...config, level: 'intermediate' }, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 0, 'N5 words are not intermediate');

    result = await run(runPipeline({ ...config, level: 'beginner' }, [feedSource('news')], '2026-09-15'));
    assert.ok(result.wordsCollected > 0);
  });

  it('skips articles too short to use, without asking Jisho', async () => {
    serve({ feeds: { news: [{ url: 'http://news.test/tiny', body: inline('短い') }] }, pages: { 'http://news.test/tiny': '<html><body><p>短い</p></body></html>' }, jisho: 'all' });
    const result = await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 0);
    assert.deepEqual(jishoCalls(), []);
  });

  it('scrapes an article when the feed carries no body', async () => {
    serve({
      feeds: { news: [{ url: 'http://news.test/park', title: 'park' }] },
      pages: { 'http://news.test/park': `<html><body><article><p>${ART.park.repeat(4)}</p></article></body></html>` },
      jisho: 'all',
    });
    config.max_words_per_run = 1;
    const result = await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 1);
    assert.ok(calls.some(c => c.url === 'http://news.test/park'));
  });

  it('reports no words, writes nothing and logs nothing when nothing is found', async () => {
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: {} });
    const result = await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    assert.deepEqual(result, { wordsCollected: 0, outputPaths: { json: '', markdown: '', html: '' } });
    assert.deepEqual(fs.readdirSync(config.output.json), []);
    assert.ok(!fs.existsSync(path.join(config.output.html, 'digest-2026-09-15.html')));
    assert.deepEqual(runLog(), []);
    assert.match(con.warn.join('\n'), /No new words found/);
  });

  it('reports no words when every feed fails', async () => {
    serve({ feeds: { news: 'fail' }, pages: {}, jisho: 'all' });
    const result = await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 0);
  });

  it('adds examples for a word from the other collected articles', async () => {
    // 公園 is taught from the first article and appears again in the second, which teaches 昨日.
    serve({ feeds: { news: [article('park', 0), article('parkAgain', 1)] }, pages: {}, jisho: { 公園: {}, 昨日: {} } });
    config.max_words_per_run = 2;
    config.max_examples_per_word = 2;
    config.fetch_concurrency = 2;
    const result = await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 2);
    const records = readJson(config.output.json, 'words-2026-09-15.json').fullRecords as Array<{ word: string; examples: Array<{ plain: string; sourceUrl: string }> }>;
    const park = records.find(r => r.word === '公園')!;
    assert.equal(park.examples.length, 2);
    assert.deepEqual(park.examples.map(e => e.sourceUrl.split('#')[0]).sort(), ['http://news.test/park', 'http://news.test/parkAgain']);
    assert.equal(new Set(park.examples.map(e => e.plain)).size, 2, 'distinct sentences');
    assert.match(con.log.join('\n'), /公園: 1 → 2 example\(s\)/);
  });

  it('resurfaces a previously taught word for review', async () => {
    const seed = new WordDatabase(config.database.path);
    const old = makeRecord({ word: '猫', reading: 'ねこ', definition: 'cat', date: '2026-08-01' });
    seed.markSeen(old);
    seed.close();

    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: 'all' });
    config.max_words_per_run = 1;
    await run(runPipeline(config, [feedSource('news')], '2026-09-15'));

    const json = readJson(config.output.json, 'words-2026-09-15.json');
    assert.deepEqual(json.reviewWord, old);
    assert.equal(json.ankiNotes.length, 1, 'the review word is not exported as a new card');
    assert.equal(json.fullRecords.length, 1);
    assert.match(read(path.join(config.output.html, 'digest-2026-09-15.html')), /class="card is-review"[\s\S]*猫/);
    assert.match(read(path.join(config.output.markdown, 'digest-2026-09-15.md')), /📖 Review: 猫【ねこ】/);

    const conn = new Database(config.database.path, { readonly: true });
    const row = conn.prepare("SELECT last_reviewed_at FROM seen_words WHERE word = '猫'").get() as { last_reviewed_at: string };
    conn.close();
    assert.equal(row.last_reviewed_at, '2026-09-15');
  });

  it('does not review the word it just taught', async () => {
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: 'all' });
    config.max_words_per_run = 1;
    await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    assert.equal(readJson(config.output.json, 'words-2026-09-15.json').reviewWord, undefined);
  });

  it('translates examples with Ollama and highlights the definition', async () => {
    config.translation.provider = 'ollama';
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: { 公園: { def: 'to play' } }, ollama: () => 'Children play in the park.' });
    config.max_words_per_run = 1;
    await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    const [record] = readJson(config.output.json, 'words-2026-09-15.json').fullRecords;
    assert.equal(record.word, '公園');
    assert.ok(record.examples.length >= 1);
    for (const ex of record.examples) {
      assert.equal(ex.translation, 'Children play in the park.');
      assert.equal(ex.translationMarkedHtml, 'Children <mark>play</mark> in the park.');
    }
    assert.match(read(path.join(config.output.html, 'digest-2026-09-15.html')), /<details class="tr"><summary>English<\/summary><p>Children <mark>play<\/mark> in the park\.<\/p>/);
  });

  it('carries on without translations when the provider is unreachable', async () => {
    config.translation.provider = 'ollama';
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: 'all' });
    config.max_words_per_run = 1;
    const result = await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 1);
    const [record] = readJson(config.output.json, 'words-2026-09-15.json').fullRecords;
    assert.equal(record.examples[0].translation, undefined);
  });

  it('generates audio and attaches it to the word and its examples', async () => {
    config.tts.provider = 'openai';
    restoreEnv(); restoreEnv = setEnv({ OPENAI_API_KEY: 'sk-test' });
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: 'all', openai: true });
    config.max_words_per_run = 1;
    await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    const [record] = readJson(config.output.json, 'words-2026-09-15.json').fullRecords;
    assert.equal(record.audioProvider, 'openai');
    assert.equal(record.wordAudioFile, 'audio/2026-09-15-0-word.mp3');
    assert.equal(record.wordAudioFileSlow, 'audio/2026-09-15-0-word-slow.mp3');
    assert.equal(record.wordAudioFileVslow, 'audio/2026-09-15-0-word-vslow.mp3');
    assert.equal(record.examples[0].audioFile, 'audio/2026-09-15-0-ex0.mp3');
    assert.ok(fs.existsSync(path.join(config.output.html, record.wordAudioFile)));
    assert.match(read(path.join(config.output.html, 'digest-2026-09-15.html')), /<audio class="audio-word" data-speed="normal" src="audio\/2026-09-15-0-word\.mp3"/);
  });

  it('uses the run slug for output names, so a second run the same day does not overwrite the first', async () => {
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: 'all' });
    config.max_words_per_run = 1;
    await run(runPipeline(config, [feedSource('news')], '2026-09-15'));
    restoreFetch();
    serve({ feeds: { news: [article('library')] }, pages: {}, jisho: 'all' });
    await run(runPipeline(config, [feedSource('news')], '2026-09-15-2'));
    assert.deepEqual(fs.readdirSync(config.output.json).sort(), ['words-2026-09-15-2.json', 'words-2026-09-15.json']);
    assert.match(read(path.join(config.output.html, 'digest-2026-09-15.html')), /digest-2026-09-15-2\.html" rel="next"/);
    assert.equal(runLog().length, 2);
  });
});

describe('runWordPipeline', () => {
  const feeds = () => ({ news: [article('park', 0), article('library', 1)] });

  it('finds an article containing the word and digests just that word', async () => {
    serve({ feeds: feeds(), pages: {}, jisho: { 図書館: { reading: 'としょかん' } } });
    const result = await run(runWordPipeline('図書館', config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 1);
    const [record] = readJson(config.output.json, 'words-2026-09-15.json').fullRecords;
    assert.equal(record.word, '図書館');
    assert.equal(record.reading, 'としょかん');
    assert.match(record.sourceUrl, /news\.test\/library/);
    assert.deepEqual(seenWords(), ['図書館']);
    assert.deepEqual(runLog().map(r => [r.word_count, r.sources]), [[1, 'news-domain']]);
  });

  it('files the result as a custom run', async () => {
    serve({ feeds: feeds(), pages: {}, jisho: 'all' });
    await run(runWordPipeline('公園', config, [feedSource('news')], '2026-09-15'));
    assert.ok(fs.existsSync(path.join(config.output.html, 'manual-manifest.json')));
    assert.ok(fs.existsSync(path.join(config.output.html, 'manual.html')));
    assert.ok(!fs.existsSync(path.join(config.output.html, 'manifest.json')));
    assert.match(read(path.join(config.output.html, 'digest-2026-09-15.html')), /Custom run/);
  });

  it('matches the dictionary form, and the surface form as it appears in the article', async () => {
    // The library article says 読んでいます: surface 読ん, dictionary form 読む.
    for (const target of ['読む', '読ん']) {
      restoreFetch?.();
      serve({ feeds: feeds(), pages: {}, jisho: 'all' });
      const result = await run(runWordPipeline(target, config, [feedSource('news')], `2026-09-15-${target === '読む' ? 1 : 2}`));
      assert.equal(result.wordsCollected, 1, target);
      assert.deepEqual(jishoCalls(), ['読む'], 'Jisho is asked about the dictionary form');
    }
  });

  it('does not match a form that is not in any article', async () => {
    serve({ feeds: feeds(), pages: {}, jisho: 'all' });
    const result = await run(runWordPipeline('読み', config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 0);
  });

  it('reports not found without writing anything', async () => {
    serve({ feeds: feeds(), pages: {}, jisho: 'all' });
    const result = await run(runWordPipeline('存在しない', config, [feedSource('news')], '2026-09-15'));
    assert.deepEqual(result, { wordsCollected: 0, outputPaths: { json: '', markdown: '', html: '' } });
    assert.deepEqual(fs.readdirSync(config.output.json), []);
    assert.deepEqual(runLog(), []);
    assert.match(con.log.join('\n'), /"存在しない" not found in any article/);
  });

  it('gives up on an article when Jisho has no entry, and tries the next', async () => {
    serve({ feeds: { news: [article('park', 0), article('parkAgain', 1)] }, pages: {}, jisho: {} });
    const result = await run(runWordPipeline('公園', config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 0);
    assert.equal(jishoCalls().filter(w => w === '公園').length, 2, 'looked up once per article');
  });
});

describe('runSourcePipeline', () => {
  it('picks a word from the named source only', async () => {
    serve({ feeds: { news: [article('park')], blog: [article('school')] }, pages: {}, jisho: 'all' });
    const result = await run(runSourcePipeline('blog', config, [feedSource('news'), feedSource('blog')], '2026-09-15'));
    assert.equal(result.wordsCollected, 1);
    const [record] = readJson(config.output.json, 'words-2026-09-15.json').fullRecords;
    assert.match(record.sourceUrl, /news\.test\/school/);
    assert.equal(record.domain, 'blog-domain');
    assert.ok(!calls.some(c => c.url.includes('/news.json')), 'the other feed is not fetched');
    assert.ok(fs.existsSync(path.join(config.output.html, 'manual.html')), 'custom run');
  });

  it('rejects an unknown source, naming the ones it knows', async () => {
    await assert.rejects(
      runSourcePipeline('nope', config, [feedSource('news'), feedSource('blog')], '2026-09-15'),
      /Source "nope" not found in sources\.yaml\. Available: news, blog/,
    );
  });

  it('reports no word when the source yields none', async () => {
    serve({ feeds: { news: [article('park')] }, pages: {}, jisho: {} });
    const result = await run(runSourcePipeline('news', config, [feedSource('news')], '2026-09-15'));
    assert.equal(result.wordsCollected, 0);
    assert.deepEqual(runLog(), []);
    assert.match(con.log.join('\n'), /No suitable word found in source "news"/);
  });
});

describe('runUrlPipeline', () => {
  const url = 'https://www.example.co.jp/story/1';
  const html = (text: string) => `<html><body><article><p>${text}</p></article></body></html>`;

  it('digests a word from one article, tagged with the site\'s hostname', async () => {
    serve({ feeds: {}, pages: { [url]: html(ART.park.repeat(4)) }, jisho: 'all' });
    const result = await run(runUrlPipeline(url, config, '2026-09-15'));
    assert.equal(result.wordsCollected, 1);
    const [record] = readJson(config.output.json, 'words-2026-09-15.json').fullRecords;
    assert.equal(record.domain, 'www.example.co.jp');
    assert.equal(record.sourceUrl, url);
    assert.ok(record.examples[0].sourceUrl.startsWith(url + '#:~:text='));
    assert.ok(record.examples[0].articleText.length > 0, 'keeps a saved copy of the article');
    assert.deepEqual(runLog().map(r => r.sources), ['www.example.co.jp']);
  });

  it('falls back to the whole string as the domain when the URL cannot be parsed', async () => {
    const odd = 'example.com/story/2';
    serve({ feeds: {}, pages: { [odd]: html(ART.park.repeat(4)) }, jisho: 'all' });
    const result = await run(runUrlPipeline(odd, config, '2026-09-15'));
    assert.equal(result.wordsCollected, 1);
    assert.equal(readJson(config.output.json, 'words-2026-09-15.json').fullRecords[0].domain, odd);
  });

  it('throws when the page has no usable text', async () => {
    serve({ feeds: {}, pages: { [url]: html('短い') }, jisho: 'all' });
    await assert.rejects(run(runUrlPipeline(url, config, '2026-09-15')), /Could not extract usable text from https:\/\/www\.example\.co\.jp\/story\/1/);
    assert.deepEqual(runLog(), []);
  });

  it('throws when the page cannot be fetched', async () => {
    serve({ feeds: {}, pages: {}, jisho: 'all' });
    await assert.rejects(run(runUrlPipeline(url, config, '2026-09-15')), /Could not extract usable text/);
  });

  it('reports no word when Jisho knows none of the candidates', async () => {
    serve({ feeds: {}, pages: { [url]: html(ART.park.repeat(4)) }, jisho: {} });
    const result = await run(runUrlPipeline(url, config, '2026-09-15'));
    assert.equal(result.wordsCollected, 0);
    assert.match(con.log.join('\n'), /No suitable word found in this article/);
  });

  it('skips words already in the database', async () => {
    serve({ feeds: {}, pages: { [url]: html(ART.park.repeat(4)) }, jisho: 'all' });
    await run(runUrlPipeline(url, config, '2026-09-15'));
    const first = seenWords();
    await run(runUrlPipeline(url, config, '2026-09-16'));
    const both = seenWords();
    assert.equal(both.length, 2);
    assert.ok(first.every(w => both.includes(w)));
  });
});

describe('Jisho outage', () => {
  // Last in the file: Jisho's failure counters are process-wide and, once tripped, stay tripped.
  it('aborts the run with a clear error instead of hammering a dead service', async () => {
    serve({ feeds: { news: [article('park'), article('library'), article('school'), article('hospital')] }, pages: {}, jisho: 'down' });
    await assert.rejects(
      run(runPipeline(config, [feedSource('news')], '2026-09-15')),
      /Jisho lookups are failing .*Aborting run/,
    );
    assert.deepEqual(fs.readdirSync(config.output.json), [], 'nothing was published');
    assert.ok(jishoCalls().length <= 6, `made ${jishoCalls().length} requests`);
  });
});
