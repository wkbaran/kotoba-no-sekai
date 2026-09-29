import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { buildDigestPage, rebuildDigests, writeHtmlOutput } from '../src/output/html';
import { captureConsole, cleanupTmpDirs, makeExample, makeRecord, read, tmpDir, write, type Captured } from './helpers';

let con: Captured;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { con.restore(); cleanupTmpDirs(); });

const page = (records = [makeRecord()], review: ReturnType<typeof makeRecord> | null = null, opts: Parameters<typeof buildDigestPage>[3] = {}) =>
  buildDigestPage(records, '2026-09-01', review, opts);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('buildDigestPage: page', () => {
  it('is a complete HTML document titled with the date', () => {
    const html = page();
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<title>言葉の世界 Tuesday, September 1, 2026<\/title>/);
    assert.match(html, /<h1>Tuesday, September 1, 2026<\/h1>/);
    assert.ok(html.trimEnd().endsWith('</html>'));
  });

  it('marks a manual run', () => {
    assert.ok(!page().includes('Custom run'));
    assert.match(page([makeRecord()], null, { mode: 'manual' }), /<h1>.*<span class="kind">Custom run<\/span><\/h1>/);
  });

  it('includes the site footer with the dictionary attribution', () => {
    assert.match(page(), /class="attribution"/);
  });

  it('shows the Custom nav link only when asked', () => {
    assert.ok(!page().includes('manual.html'));
    assert.match(page([makeRecord()], null, { showCustom: true }), /href="manual\.html"/);
  });

  it('links to the previous and next day, or shows a disabled next', () => {
    const both = page([makeRecord()], null, { prev: '2026-08-31', next: '2026-09-02' });
    assert.match(both, /<a href="digest-2026-08-31\.html" rel="prev"[^>]*>.*Aug 31/);
    assert.match(both, /<!--next-day--><a href="digest-2026-09-02\.html" rel="next"[^>]*>Sep 2 .*<\/a><!--\/next-day-->/);

    const neither = page();
    assert.ok(!neither.includes('rel="prev"'));
    assert.match(neither, /<!--next-day--><span aria-disabled="true">Next day<\/span><!--\/next-day-->/);
  });

  it('labels a later run on the same day', () => {
    assert.match(page([makeRecord()], null, { prev: '2026-09-01' }), /Previous day, Sep 1"/);
    assert.match(page([makeRecord()], null, { next: '2026-09-01-2' }), /digest-2026-09-01-2\.html.*Sep 1, run 2/);
  });

  it('prefixes links with a base path', () => {
    const html = page([makeRecord({ wordAudioFile: 'audio/w.mp3' })], null, { base: '../', prev: '2026-08-31', next: '2026-09-02' });
    assert.match(html, /href="\.\.\/digest-2026-08-31\.html"/);
    assert.match(html, /href="\.\.\/digest-2026-09-02\.html"/);
    assert.match(html, /src="\.\.\/audio\/w\.mp3"/);
    assert.match(html, /href="\.\.\/index\.html"/);
  });
});

describe('buildDigestPage: cards', () => {
  it('has one card per word, numbered, with a tab for each', () => {
    const html = page([makeRecord(), makeRecord({ word: '猫', reading: 'ねこ' })]);
    assert.equal(count(html, /<section class="card/g), 2);
    assert.match(html, /id="w1" data-entry aria-label="Word 1 of 2"/);
    assert.match(html, /id="w2" data-entry aria-label="Word 2 of 2"/);
    assert.match(html, /<li><a href="#w1" data-go="0" lang="ja">食べる<\/a><\/li>/);
    assert.match(html, /<li><a href="#w2" data-go="1" lang="ja">猫<\/a><\/li>/);
  });

  it('shows the word, reading and definition', () => {
    const html = page([makeRecord({ word: '猫', reading: 'ねこ', definition: 'cat' })]);
    assert.match(html, /<h2 class="word" lang="ja">猫<\/h2>/);
    assert.match(html, /<p class="reading" lang="ja">ねこ<\/p>/);
    assert.match(html, /<p class="meaning">cat<\/p>/);
  });

  it('starts with the reading and meaning covered', () => {
    const html = page();
    assert.match(html, /data-show="reading"/);
    assert.match(html, /data-show="meaning"/);
    assert.match(html, /Show reading/);
    assert.match(html, /Show meaning/);
  });

  it('hints at the reading length without giving it away, counting small kana', () => {
    const html = page([makeRecord({ reading: 'きょう' })]);
    assert.match(html, /<span class="dots-note">3 kana, 1 small<\/span>/);
    assert.equal(count(html, /<i class="sm"><\/i>/g), 1, 'only ょ is small');
    assert.equal(count(html, /<i><\/i>/g), 2);
    assert.match(page([makeRecord({ reading: 'たべる' })]), /3 kana<\/span>/);
  });

  it('lists up to three alternative definitions', () => {
    const html = page([makeRecord({ altDefinitions: ['a', 'b', 'c', 'd'] })]);
    assert.match(html, /<p class="also">Also a, b, c<\/p>/);
    assert.ok(!page([makeRecord({ altDefinitions: [] })]).includes('class="also"'));
  });

  it('shows the JLPT level, or a note when there is none', () => {
    assert.match(page([makeRecord({ jlptLevel: 'N3' })]), /title="JLPT level">N3</);
    assert.match(page([makeRecord({ jlptLevel: 'unknown' })]), /title="JLPT level">No JLPT level</);
  });

  it('shows a lower-cased part of speech without the parenthetical', () => {
    assert.match(page([makeRecord({ pos: 'Godan verb with \'u\' ending (irregular)' })]), /<span>godan verb with 'u' ending<\/span>/);
    assert.match(page([makeRecord({ pos: 'Noun' })]), /<span>noun<\/span>/);
  });

  it('escapes HTML in every field it prints', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = page([makeRecord({
      word: evil, reading: evil, definition: evil, altDefinitions: [evil], pos: evil, sourceUrl: 'https://e.com/?a="b"&c=<d>',
      examples: [makeExample({ plain: evil, articleText: evil })],
    })]);
    assert.ok(!html.includes('<img src=x'), 'no raw tag from record data');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.match(html, /href="https:\/\/e\.com\/\?a=&quot;b&quot;&amp;c=&lt;d&gt;"/);
  });
});

describe('buildDigestPage: examples', () => {
  it('renders the glossed sentence for each example, with a play button and its text', () => {
    const html = page([makeRecord({
      examples: [makeExample({ glossedHtml: '<GLOSS-1>', plain: '一つ目。' }), makeExample({ glossedHtml: '<GLOSS-2>', plain: '二つ目。' })],
    })]);
    assert.equal(count(html, /<li class="ex">/g), 2);
    assert.match(html, /<p class="jp" lang="ja"><GLOSS-1><\/p>/);
    assert.match(html, /<p class="jp" lang="ja"><GLOSS-2><\/p>/);
    assert.match(html, /data-play="ex" data-index="0" data-text="一つ目。"/);
    assert.match(html, /data-play="ex" data-index="1" data-text="二つ目。"/);
  });

  it('falls back to the marked sentence for records saved before glossing existed', () => {
    const legacy = makeExample({ markedHtml: '<mark>旧</mark>形式' });
    delete (legacy as Partial<typeof legacy>).glossedHtml;
    assert.match(page([makeRecord({ examples: [legacy] })]), /<p class="jp" lang="ja"><mark>旧<\/mark>形式<\/p>/);
  });

  it('adds an English toggle only for translated examples', () => {
    const html = page([makeRecord({ examples: [
      makeExample({ translationMarkedHtml: 'I <mark>eat</mark> rice.' }),
      makeExample({ translationMarkedHtml: undefined }),
    ] })]);
    assert.equal(count(html, /<details class="tr">/g), 1);
    assert.match(html, /<summary>English<\/summary><p>I <mark>eat<\/mark> rice\.<\/p>/);
  });

  it('links to the source article with a friendly name', () => {
    const name = (url: string) => page([makeRecord({ sourceUrl: url })]).match(/Read the article on ([^<]+)</)?.[1];
    assert.equal(name('https://www3.nhk.or.jp/news/a.html'), 'NHK');
    assert.equal(name('https://www.asahi.com/articles/x.html'), 'Asahi Shimbun');
    assert.equal(name('https://digital.asahi.com/x'), 'Asahi Shimbun');
    assert.equal(name('https://watanoc.com/a'), 'Watanoc');
    assert.equal(name('https://www.example.co.jp/a'), 'example.co.jp');
    assert.equal(name('https://www2.example.org/a'), 'example.org');
    assert.equal(name('not a url'), 'the source');
  });

  it('opens the source in a new tab safely', () => {
    assert.match(page(), /<a href="https:\/\/www3\.nhk\.or\.jp\/news\/a\.html" target="_blank" rel="noopener">/);
  });

  it('offers the saved article text when an example has it', () => {
    const html = page([makeRecord({ examples: [makeExample({ articleText: '' }), makeExample({ articleText: '保存された "本文"' })] })]);
    assert.match(html, /<button type="button" class="linkish" data-saved="保存された &quot;本文&quot;" data-src="https:\/\/www3\.nhk\.or\.jp\/news\/a\.html">Saved copy<\/button>/);
    assert.ok(!page([makeRecord({ examples: [makeExample({ articleText: '' })] })]).includes('Saved copy</button>'));
  });
});

describe('buildDigestPage: audio', () => {
  it('has no audio elements when there is none', () => {
    assert.equal(count(page(), /<audio /g), 0);
  });

  it('emits an element per available file, tagged by speed and example index', () => {
    const html = page([makeRecord({
      wordAudioFile: 'audio/w.mp3', wordAudioFileSlow: 'audio/w-slow.mp3', wordAudioFileVslow: 'audio/w-vslow.mp3',
      examples: [
        makeExample({ audioFile: 'audio/e0.mp3', audioFileSlow: 'audio/e0-slow.mp3' }),
        makeExample({ audioFile: 'audio/e1.mp3' }),
      ],
    })]);
    assert.equal(count(html, /<audio /g), 6);
    assert.match(html, /<audio class="audio-word" data-speed="normal" src="audio\/w\.mp3" preload="none">/);
    assert.match(html, /<audio class="audio-word" data-speed="vslow" src="audio\/w-vslow\.mp3"/);
    assert.match(html, /<audio class="audio-ex" data-speed="slow" data-index="0" src="audio\/e0-slow\.mp3"/);
    assert.match(html, /<audio class="audio-ex" data-speed="normal" data-index="1" src="audio\/e1\.mp3"/);
    assert.ok(!html.includes('e1-slow'));
  });
});

describe('buildDigestPage: review word', () => {
  const review = () => makeRecord({ word: '飲む', reading: 'のむ', date: '2026-08-15' });

  it('is added after the new words and counted in the total', () => {
    const html = page([makeRecord()], review());
    assert.equal(count(html, /<section class="card/g), 2);
    assert.match(html, /aria-label="Word 2 of 2"/);
    assert.match(html, /<section class="card is-review" id="w2"/);
    assert.match(html, /<span class="review">Review from Aug 15<\/span>/);
    assert.match(html, /<li><a href="#w2" data-go="1" lang="ja" class="is-review" title="Review word">飲む<\/a><\/li>/);
  });

  it('is absent when there is none', () => {
    const html = page();
    assert.ok(!html.includes('<section class="card is-review"'));
    assert.ok(!html.includes('Review from'));
  });
});

describe('buildDigestPage: review word styling', () => {
  it('draws the review word in solid type, like any other word', () => {
    const html = page([makeRecord()], makeRecord({ word: '飲む' }));
    assert.ok(!html.includes('text-stroke'), 'no outline effect');
    assert.ok(!/\.is-review\s+\.word/.test(html), 'no special styling for the review word');
    assert.ok(!/\.word\s*\{[^}]*color:\s*transparent/.test(html));
  });

  it('still marks the review card with a label and a tab note', () => {
    const html = page([makeRecord()], makeRecord({ word: '飲む' }));
    assert.match(html, /<span class="review">Review from /);
    assert.match(html, /\.tabs a\.is-review::after \{ content: "review"/);
  });
});

describe('buildDigestPage: forms table', () => {
  it('is shown for a verb, with the forms used in the sentences marked', () => {
    const html = page([makeRecord({
      word: '食べる', pos: 'Ichidan verb',
      examples: [makeExample({ plain: '毎日ご飯を食べています。' })],
    })]);
    assert.match(html, /<details class="forms" data-forms>/);
    assert.match(html, /<h3>Forms <span>ichidan verb<\/span><\/h3>/);
    assert.match(html, /In the sentence: <span lang="ja">食べています<\/span> \(progressive, polite\)\./);
    assert.match(html, /<mark>食べています<\/mark>/);
    assert.match(html, /<th scope="row">Negative<\/th><td lang="ja">食べない<\/td><td lang="ja" class="pol">食べません<\/td>/);
    assert.match(html, /<th scope="row">Te-form<\/th><td lang="ja" colspan="2">食べて<\/td>/);
  });

  it('says "sentences" when there are several, and names every form sharing a spelling', () => {
    const html = page([makeRecord({
      word: '食べる', pos: 'Ichidan verb',
      examples: [makeExample({ plain: '食べられる。' }), makeExample({ plain: '食べた。' })],
    })]);
    assert.match(html, /In the sentences: /);
    assert.match(html, /食べられる<\/span> \(potential or passive\)/);
  });

  it('describes the pattern when no form appears in the sentences', () => {
    const html = page([makeRecord({ word: '食べる', pos: 'Ichidan verb', examples: [makeExample({ plain: '関係のない文章です。' })] })]);
    assert.match(html, /<p class="forms-note">Every ichidan verb follows this pattern/);
    const table = html.slice(html.indexOf('<details class="forms"'), html.indexOf('</details>', html.indexOf('<details class="forms"')));
    assert.ok(!table.includes('<mark>'), 'no form is highlighted');
  });

  it('is shown for adjectives', () => {
    assert.match(page([makeRecord({ word: '高い', pos: 'I-adjective (keiyoushi)', examples: [makeExample({ plain: '高くなかった。' })] })]), /<h3>Forms <span>い-adjective<\/span>/);
    assert.match(page([makeRecord({ word: '静か', pos: 'Na-adjective (keiyodoshi)' })]), /<h3>Forms <span>な-adjective<\/span>/);
  });

  it('is left out for a word with no table', () => {
    assert.ok(!page([makeRecord({ word: '猫', pos: 'Noun' })]).includes('class="forms"'));
    assert.ok(!page([makeRecord({ word: '信ずる', pos: 'Ichidan verb - zuru verb' })]).includes('class="forms"'));
  });
});

describe('writeHtmlOutput', () => {
  it('writes digest-<date>.html and returns its path', () => {
    const dir = tmpDir();
    const out = writeHtmlOutput([makeRecord()], '2026-09-01', dir);
    assert.equal(out, path.join(dir, 'digest-2026-09-01.html'));
    assert.match(read(out), /<title>言葉の世界 Tuesday, September 1, 2026<\/title>/);
  });

  it('links to the neighbouring digests already on disk', () => {
    const dir = tmpDir();
    write(path.join(dir, 'digest-2026-08-30.html'), 'x');
    write(path.join(dir, 'digest-2026-09-03.html'), 'x');
    const html = read(writeHtmlOutput([makeRecord()], '2026-09-01', dir));
    assert.match(html, /href="digest-2026-08-30\.html" rel="prev"/);
    assert.match(html, /href="digest-2026-09-03\.html" rel="next"/);
  });

  it('points the previous digest\'s "next day" control at the new one', () => {
    const dir = tmpDir();
    writeHtmlOutput([makeRecord()], '2026-09-01', dir);
    assert.match(read(path.join(dir, 'digest-2026-09-01.html')), /<span aria-disabled="true">Next day<\/span>/);

    writeHtmlOutput([makeRecord()], '2026-09-02', dir);
    const first = read(path.join(dir, 'digest-2026-09-01.html'));
    assert.match(first, /<!--next-day--><a href="digest-2026-09-02\.html" rel="next"[^>]*>Sep 2 .*<\/a><!--\/next-day-->/);
    assert.ok(!first.includes('aria-disabled'));
    assert.match(read(path.join(dir, 'digest-2026-09-02.html')), /href="digest-2026-09-01\.html" rel="prev"/);
  });

  it('leaves a previous page written before the marker existed alone', () => {
    const dir = tmpDir();
    write(path.join(dir, 'digest-2026-08-31.html'), '<html>old page, no marker</html>');
    writeHtmlOutput([makeRecord()], '2026-09-01', dir);
    assert.equal(read(path.join(dir, 'digest-2026-08-31.html')), '<html>old page, no marker</html>');
  });

  it('treats a second run on the same day as a later page', () => {
    const dir = tmpDir();
    writeHtmlOutput([makeRecord()], '2026-09-01', dir);
    writeHtmlOutput([makeRecord()], '2026-09-01-2', dir);
    assert.match(read(path.join(dir, 'digest-2026-09-01.html')), /href="digest-2026-09-01-2\.html" rel="next"/);
    assert.match(read(path.join(dir, 'digest-2026-09-01-2.html')), /href="digest-2026-09-01\.html" rel="prev"/);
  });

  it('keeps automatic and custom runs in separate chains', () => {
    const dir = tmpDir();
    write(path.join(dir, 'manual-manifest.json'), JSON.stringify([{ date: '2026-08-31' }]));
    write(path.join(dir, 'digest-2026-08-31.html'), 'manual page');
    write(path.join(dir, 'digest-2026-08-30.html'), 'auto page');

    const auto = read(writeHtmlOutput([makeRecord()], '2026-09-01', dir, null, 'auto'));
    assert.match(auto, /href="digest-2026-08-30\.html" rel="prev"/, 'previous auto run');
    assert.ok(!auto.includes('digest-2026-08-31.html'));

    const manual = read(writeHtmlOutput([makeRecord()], '2026-09-02', dir, null, 'manual'));
    assert.match(manual, /href="digest-2026-08-31\.html" rel="prev"/, 'previous manual run');
    assert.match(manual, /Custom run/);
    assert.match(manual, /href="manual\.html"/, 'custom link is always shown on a custom page');
  });

  it('shows the Custom nav link on automatic pages once custom runs exist', () => {
    const dir = tmpDir();
    write(path.join(dir, 'manual-manifest.json'), JSON.stringify([{ date: '2026-08-31' }]));
    assert.match(read(writeHtmlOutput([makeRecord()], '2026-09-01', dir)), /href="manual\.html"/);
  });

  it('ignores files that are not digests', () => {
    const dir = tmpDir();
    write(path.join(dir, 'digest-2026-08-31.md'), 'x');
    write(path.join(dir, 'index.html'), 'x');
    write(path.join(dir, 'digest-latest.html'), 'x');
    assert.ok(!read(writeHtmlOutput([makeRecord()], '2026-09-01', dir)).includes('rel="prev"'));
  });

  it('renders the review word', () => {
    const dir = tmpDir();
    const html = read(writeHtmlOutput([makeRecord()], '2026-09-01', dir, makeRecord({ word: '飲む', reading: 'のむ' })));
    assert.match(html, /class="card is-review"/);
  });
});

describe('rebuildDigests', () => {
  const setup = () => {
    const web = tmpDir(), data = tmpDir();
    return { web, data };
  };

  it('re-renders each existing digest from its JSON', () => {
    const { web, data } = setup();
    write(path.join(web, 'digest-2026-09-01.html'), 'stale');
    write(path.join(web, 'digest-2026-09-02.html'), 'stale');
    write(path.join(data, 'words-2026-09-01.json'), JSON.stringify({ fullRecords: [makeRecord({ word: '猫' })] }));
    write(path.join(data, 'words-2026-09-02.json'), JSON.stringify({ fullRecords: [makeRecord({ word: '犬' })] }));

    rebuildDigests(web, data);

    const one = read(path.join(web, 'digest-2026-09-01.html'));
    assert.match(one, /<h2 class="word" lang="ja">猫<\/h2>/);
    assert.match(one, /rel="next"/, 'linked to the following day');
    assert.match(read(path.join(web, 'digest-2026-09-02.html')), /<h2 class="word" lang="ja">犬<\/h2>/);
    assert.match(con.log.join('\n'), /2 digest pages rebuilt/);
  });

  it('includes the stored review word', () => {
    const { web, data } = setup();
    write(path.join(web, 'digest-2026-09-01.html'), 'stale');
    write(path.join(data, 'words-2026-09-01.json'), JSON.stringify({ fullRecords: [makeRecord()], reviewWord: makeRecord({ word: '飲む' }) }));
    rebuildDigests(web, data);
    assert.match(read(path.join(web, 'digest-2026-09-01.html')), /class="card is-review"[\s\S]*飲む/);
  });

  it('accepts a JSON file that is a bare array of records', () => {
    const { web, data } = setup();
    write(path.join(web, 'digest-2026-09-01.html'), 'stale');
    write(path.join(data, 'words-2026-09-01.json'), JSON.stringify([makeRecord({ word: '猫' })]));
    rebuildDigests(web, data);
    assert.match(read(path.join(web, 'digest-2026-09-01.html')), /猫/);
  });

  it('skips, with a warning, a digest that has no JSON', () => {
    const { web, data } = setup();
    write(path.join(web, 'digest-2026-09-01.html'), 'untouched');
    rebuildDigests(web, data);
    assert.equal(read(path.join(web, 'digest-2026-09-01.html')), 'untouched');
    assert.match(con.warn.join('\n'), /Skipping digest-2026-09-01\.html: no words-2026-09-01\.json/);
    assert.match(con.log.join('\n'), /0 digest pages rebuilt/);
  });

  it('does not create digests for JSON files that have none', () => {
    const { web, data } = setup();
    write(path.join(data, 'words-2026-09-01.json'), JSON.stringify({ fullRecords: [makeRecord()] }));
    rebuildDigests(web, data);
    assert.deepEqual(fs.readdirSync(web), []);
    assert.match(con.log.join('\n'), /0 digest pages rebuilt/);
  });

  it('rebuilds custom runs as custom pages, in their own chain', () => {
    const { web, data } = setup();
    write(path.join(web, 'manual-manifest.json'), JSON.stringify([{ date: '2026-09-02' }]));
    write(path.join(web, 'digest-2026-09-01.html'), 'stale');
    write(path.join(web, 'digest-2026-09-02.html'), 'stale');
    for (const d of ['2026-09-01', '2026-09-02']) write(path.join(data, `words-${d}.json`), JSON.stringify({ fullRecords: [makeRecord()] }));
    rebuildDigests(web, data);
    const auto = read(path.join(web, 'digest-2026-09-01.html'));
    const manual = read(path.join(web, 'digest-2026-09-02.html'));
    assert.ok(!auto.includes('Custom run'));
    assert.ok(!auto.includes('rel="next"'), 'the custom run is not its next day');
    assert.match(manual, /Custom run/);
    assert.match(auto, /href="manual\.html"/, 'custom link is shown once custom runs exist');
  });

  it('uses singular for one page', () => {
    const { web, data } = setup();
    write(path.join(web, 'digest-2026-09-01.html'), 'stale');
    write(path.join(data, 'words-2026-09-01.json'), JSON.stringify({ fullRecords: [makeRecord()] }));
    rebuildDigests(web, data);
    assert.match(con.log.join('\n'), /1 digest page rebuilt/);
  });
});
