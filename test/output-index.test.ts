import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { buildMasterWordsIndex, rebuildIndexOutput, writeIndexOutput } from '../src/output/index';
import { captureConsole, cleanupTmpDirs, makeRecord, read, tmpDir, write, type Captured } from './helpers';

let con: Captured;
let web: string;
let data: string;
beforeEach(() => { con = captureConsole(); web = tmpDir(); data = tmpDir(); });
afterEach(() => { con.restore(); cleanupTmpDirs(); });

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const manifest = (name = 'manifest.json') => JSON.parse(read(path.join(web, name))) as Array<{ date: string; wordCount: number; words: Array<{ word: string; definition: string; jlptLevel?: string }>; file: string }>;
const saveWords = (id: string, records = [makeRecord()]) =>
  write(path.join(data, `words-${id}.json`), JSON.stringify({ fullRecords: records }));

describe('writeIndexOutput: daily runs', () => {
  it('records the day in manifest.json and writes index.html and words.html', () => {
    writeIndexOutput([makeRecord({ word: '猫', definition: 'cat', jlptLevel: 'N5' })], '2026-09-01', web, 'auto', data);
    assert.deepEqual(manifest(), [{
      date: '2026-09-01', wordCount: 1, file: 'digest-2026-09-01.html',
      words: [{ word: '猫', definition: 'cat', jlptLevel: 'N5' }],
    }]);
    assert.ok(fs.existsSync(path.join(web, 'index.html')));
    assert.ok(fs.existsSync(path.join(web, 'words.html')));
    assert.ok(!fs.existsSync(path.join(web, 'manual.html')));
  });

  it('shows the newest words with links into the digest', () => {
    writeIndexOutput([makeRecord({ word: '猫', definition: 'cat' }), makeRecord({ word: '犬', definition: 'dog' })], '2026-09-01', web, 'auto', data);
    const html = read(path.join(web, 'index.html'));
    assert.match(html, /<title>言葉の世界<\/title>/);
    assert.match(html, /Newest words, <strong>Tuesday, September 1, 2026<\/strong>/);
    assert.match(html, /<a href="digest-2026-09-01\.html#w1"><span class="w" lang="ja">猫<\/span><span class="m">cat<\/span><\/a>/);
    assert.match(html, /<a href="digest-2026-09-01\.html#w2"><span class="w" lang="ja">犬<\/span><span class="m">dog<\/span><\/a>/);
    assert.match(html, /<a class="start" href="digest-2026-09-01\.html">Study these words<\/a>/);
    assert.match(html, /2 words over 1 day since Tuesday, September 1, 2026\./);
  });

  it('replaces the entry when the same day is written again', () => {
    writeIndexOutput([makeRecord({ word: '猫' })], '2026-09-01', web, 'auto', data);
    writeIndexOutput([makeRecord({ word: '犬' })], '2026-09-01', web, 'auto', data);
    const entries = manifest();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].words[0].word, '犬');
  });

  it('keeps days newest first', () => {
    for (const d of ['2026-09-02', '2026-09-01', '2026-09-03']) writeIndexOutput([makeRecord({ word: d })], d, web, 'auto', data);
    assert.deepEqual(manifest().map(e => e.date), ['2026-09-03', '2026-09-02', '2026-09-01']);
    const html = read(path.join(web, 'index.html'));
    assert.match(html, /Newest words, <strong>Thursday, September 3, 2026/);
    assert.match(html, /3 words over 3 days since Tuesday, September 1, 2026\./);
  });

  it('draws one calendar per month, and links each day', () => {
    writeIndexOutput([makeRecord({ word: '八月' })], '2026-08-31', web, 'auto', data);
    writeIndexOutput([makeRecord({ word: '九月' })], '2026-09-02', web, 'auto', data);
    const html = read(path.join(web, 'index.html'));
    assert.equal(count(html, /<section class="month"/g), 2);
    assert.match(html, /September 2026 <span class="m-count">1 word<\/span>/);
    assert.match(html, /August 2026 <span class="m-count">1 word<\/span>/);
    assert.ok(html.indexOf('September 2026') < html.indexOf('August 2026'), 'newest month first');
    assert.match(html, /<td class="has newest">\s*<a href="digest-2026-09-02\.html"/);
    assert.match(html, /<td class="has">\s*<a href="digest-2026-08-31\.html"/);
    assert.equal(count(html, /<th scope="col">/g), 14, '7 weekday headings per month');
  });

  it('greys out days after the newest', () => {
    writeIndexOutput([makeRecord()], '2026-09-02', web, 'auto', data);
    const html = read(path.join(web, 'index.html'));
    assert.match(html, /<td class="future"><span class="d">30<\/span><\/td>/);
    assert.match(html, /<td class="none"><span class="d">1<\/span><\/td>/);
  });

  it('adds a "run 2" link for a second run on the same day', () => {
    writeIndexOutput([makeRecord({ word: '一回目' })], '2026-09-01', web, 'auto', data);
    writeIndexOutput([makeRecord({ word: '二回目' })], '2026-09-01-2', web, 'auto', data);
    const entries = manifest();
    assert.deepEqual(entries.map(e => e.file), ['digest-2026-09-01-2.html', 'digest-2026-09-01.html']);
    const html = read(path.join(web, 'index.html'));
    assert.match(html, /<a class="more" href="digest-2026-09-01-2\.html">run 2<\/a>/);
    assert.match(html, /2 words over 1 day/);
  });

  it('picks up digest files on disk that are not in the manifest', () => {
    write(path.join(web, 'digest-2026-08-30.html'), 'x');
    write(path.join(web, 'digest-2026-08-30.md'), 'x');
    write(path.join(web, 'digest-notes.html'), 'x');
    writeIndexOutput([makeRecord()], '2026-09-01', web, 'auto', data);
    assert.deepEqual(manifest().map(e => [e.date, e.wordCount]), [['2026-09-01', 1], ['2026-08-30', 0]]);
  });

  it('survives a corrupt manifest', () => {
    write(path.join(web, 'manifest.json'), '{not json');
    writeIndexOutput([makeRecord()], '2026-09-01', web, 'auto', data);
    assert.equal(manifest().length, 1);
  });

  it('reads manifests whose words are bare strings, from before definitions were stored', () => {
    write(path.join(web, 'manifest.json'), JSON.stringify([{ date: '2026-08-30', wordCount: 1, words: ['古い'], file: 'digest-2026-08-30.html' }]));
    writeIndexOutput([makeRecord()], '2026-09-01', web, 'auto', data);
    const html = read(path.join(web, 'index.html'));
    assert.match(html, /<span>古い<\/span>/);
    assert.ok(fs.existsSync(path.join(web, 'words.html')));
  });

  it('escapes words and definitions', () => {
    writeIndexOutput([makeRecord({ word: '<b>猫</b>', definition: '"cat" & <dog>' })], '2026-09-01', web, 'auto', data);
    const html = read(path.join(web, 'index.html'));
    assert.ok(!html.includes('<b>猫'));
    assert.match(html, /&lt;b&gt;猫&lt;\/b&gt;/);
    assert.match(html, /&quot;cat&quot; &amp; &lt;dog&gt;/);
  });

  it('shows the Custom link only once custom runs exist', () => {
    writeIndexOutput([makeRecord()], '2026-09-01', web, 'auto', data);
    assert.ok(!read(path.join(web, 'index.html')).includes('manual.html'));
    write(path.join(web, 'manual-manifest.json'), JSON.stringify([{ date: '2026-09-01', wordCount: 0, words: [], file: 'digest-2026-09-01.html' }]));
    writeIndexOutput([makeRecord()], '2026-09-02', web, 'auto', data);
    assert.match(read(path.join(web, 'index.html')), /href="manual\.html"/);
  });
});

describe('writeIndexOutput: custom runs', () => {
  it('uses the manual manifest and manual.html, leaving the daily ones alone', () => {
    writeIndexOutput([makeRecord({ word: '猫', definition: 'cat' })], '2026-09-01', web, 'manual', data);
    assert.equal(manifest('manual-manifest.json').length, 1);
    assert.ok(!fs.existsSync(path.join(web, 'manifest.json')));
    assert.ok(!fs.existsSync(path.join(web, 'index.html')));
    const html = read(path.join(web, 'manual.html'));
    assert.match(html, /<title>言葉の世界 Custom runs<\/title>/);
    assert.match(html, /<h1 class="page-title">Custom runs<\/h1>/);
    assert.match(html, /<a href="digest-2026-09-01\.html">\s*<span class="when">Tuesday, September 1, 2026<\/span>\s*<span class="ws"><span><b lang="ja">猫<\/b> cat<\/span>/);
  });

  it('does not import digest files from disk', () => {
    write(path.join(web, 'digest-2026-08-30.html'), 'x');
    writeIndexOutput([makeRecord()], '2026-09-01', web, 'manual', data);
    assert.deepEqual(manifest('manual-manifest.json').map(e => e.date), ['2026-09-01']);
  });

  it('lists several runs newest first', () => {
    writeIndexOutput([makeRecord({ word: '一' })], '2026-09-01', web, 'manual', data);
    writeIndexOutput([makeRecord({ word: '二' })], '2026-09-02', web, 'manual', data);
    const html = read(path.join(web, 'manual.html'));
    assert.ok(html.indexOf('digest-2026-09-02.html') < html.indexOf('digest-2026-09-01.html'));
  });

  it('marks Custom as the current page in the nav', () => {
    writeIndexOutput([makeRecord()], '2026-09-01', web, 'manual', data);
    assert.match(read(path.join(web, 'manual.html')), /<a href="manual\.html" aria-current="page">Custom<\/a>/);
  });
});

describe('words.html', () => {
  it('lists every word once, newest first, linking to its place in the digest', () => {
    saveWords('2026-09-01', [makeRecord({ word: '猫', reading: 'ねこ', definition: 'cat', jlptLevel: 'N5' })]);
    saveWords('2026-09-02', [makeRecord({ word: '犬', reading: 'いぬ', definition: 'dog', jlptLevel: 'N3' }), makeRecord({ word: '鳥', reading: 'とり', definition: 'bird', jlptLevel: 'unknown' })]);
    writeIndexOutput([makeRecord({ word: '猫', reading: 'ねこ', definition: 'cat', jlptLevel: 'N5' })], '2026-09-01', web, 'auto', data);
    writeIndexOutput([makeRecord({ word: '犬', definition: 'dog', jlptLevel: 'N3' }), makeRecord({ word: '鳥', definition: 'bird', jlptLevel: 'unknown' })], '2026-09-02', web, 'auto', data);

    const html = read(path.join(web, 'words.html'));
    assert.match(html, /Every word so far: 3 words from 2 days\./);
    assert.equal(count(html, /<li data-date=/g), 3);
    assert.ok(html.indexOf('>犬<') < html.indexOf('>猫<'), 'newest day first');
    assert.match(html, /<li data-date="2026-09-02" data-level="N3" data-en="dog" data-kana="いぬ" data-q="犬 いぬ dog">/);
    assert.match(html, /<a class="w" href="digest-2026-09-02\.html#w1"><b lang="ja">犬<\/b><span lang="ja">いぬ<\/span><\/a>/);
    assert.match(html, /href="digest-2026-09-02\.html#w2"/);
    assert.match(html, /data-level="other"[^>]*data-q="鳥/, 'unknown level is filed under other');
    assert.match(html, /<span class="lv">N5<\/span>/);
    assert.match(html, /<span class="dt">Sep 1<\/span>/);
  });

  it('lists a word only once if it came up on two days', () => {
    writeIndexOutput([makeRecord({ word: '猫' })], '2026-09-01', web, 'auto', data);
    writeIndexOutput([makeRecord({ word: '猫' })], '2026-09-02', web, 'auto', data);
    const html = read(path.join(web, 'words.html'));
    assert.equal(count(html, /<li data-date=/g), 1);
    assert.match(html, /Every word so far: 1 word from 2 days/);
  });

  it('includes custom runs, and shows the Custom link', () => {
    writeIndexOutput([makeRecord({ word: '猫' })], '2026-09-01', web, 'auto', data);
    writeIndexOutput([makeRecord({ word: '犬' })], '2026-09-02', web, 'manual', data);
    const html = read(path.join(web, 'words.html'));
    assert.equal(count(html, /<li data-date=/g), 2);
    assert.match(html, /href="manual\.html"/);
  });

  it('takes the reading from the words JSON when it has one, and leaves it blank when it does not', () => {
    saveWords('2026-09-01', [makeRecord({ word: '猫', reading: 'ねこ' })]);
    writeIndexOutput([makeRecord({ word: '猫', reading: 'ねこ' }), makeRecord({ word: '犬', reading: 'いぬ' })], '2026-09-01', web, 'auto', data);
    const html = read(path.join(web, 'words.html'));
    assert.match(html, /data-q="猫 ねこ/);
    assert.match(html, /<li[^>]*data-kana=""[^>]*data-q="犬 /);
    assert.ok(!html.includes('<span lang="ja">いぬ'), 'no reading shown');
  });

  it('accepts a words JSON that is a bare array', () => {
    write(path.join(data, 'words-2026-09-01.json'), JSON.stringify([makeRecord({ word: '猫', reading: 'ねこ' })]));
    writeIndexOutput([makeRecord({ word: '猫' })], '2026-09-01', web, 'auto', data);
    assert.match(read(path.join(web, 'words.html')), /data-kana="ねこ"/);
  });

  it('falls back to the JSON definition when the manifest has none', () => {
    saveWords('2026-08-30', [makeRecord({ word: '古い', reading: 'ふるい', definition: 'old', jlptLevel: 'N5' })]);
    write(path.join(web, 'manifest.json'), JSON.stringify([{ date: '2026-08-30', wordCount: 1, words: ['古い'], file: 'digest-2026-08-30.html' }]));
    buildMasterWordsIndex(web, data);
    const html = read(path.join(web, 'words.html'));
    assert.match(html, /data-en="old"/);
    assert.match(html, /data-level="N5"/);
    assert.match(html, /<span class="lv">N5<\/span>/);
  });

  it('says so when a word has no saved meaning', () => {
    write(path.join(web, 'manifest.json'), JSON.stringify([{ date: '2026-08-30', wordCount: 1, words: ['古い'], file: 'digest-2026-08-30.html' }]));
    buildMasterWordsIndex(web, data);
    assert.match(read(path.join(web, 'words.html')), /<i>No meaning saved<\/i>/);
  });

  it('is built with no words when there are no manifests', () => {
    buildMasterWordsIndex(web, data);
    const html = read(path.join(web, 'words.html'));
    assert.match(html, /Every word so far: 0 words from 0 days/);
    assert.equal(count(html, /<li data-date=/g), 0);
    assert.match(con.log.join('\n'), /Words index → .*words\.html \(0 words\)/);
  });

  it('escapes every field', () => {
    saveWords('2026-09-01', [makeRecord({ word: '<猫>', reading: '"ねこ"', definition: 'a & b' })]);
    writeIndexOutput([makeRecord({ word: '<猫>', reading: '"ねこ"', definition: 'a & b' })], '2026-09-01', web, 'auto', data);
    const html = read(path.join(web, 'words.html'));
    assert.match(html, /data-q="&lt;猫&gt; &quot;ねこ&quot; a &amp; b"/);
    assert.ok(!html.includes('<猫>'));
  });

  it('offers search, level filter, sort and a self-test toggle', () => {
    writeIndexOutput([makeRecord()], '2026-09-01', web, 'auto', data);
    const html = read(path.join(web, 'words.html'));
    assert.match(html, /id="q" type="search"/);
    for (const l of ['N5', 'N4', 'N3', 'N2', 'N1']) assert.match(html, new RegExp(`data-level="${l}" aria-pressed="false">${l}<`));
    assert.match(html, /<option value="kana">/);
    assert.match(html, /id="hide" aria-pressed="false">Hide English/);
  });
});

describe('rebuildIndexOutput', () => {
  it('rebuilds every page from the manifests and files on disk', () => {
    write(path.join(web, 'digest-2026-09-01.html'), 'x');
    saveWords('2026-09-01', [makeRecord({ word: '猫', definition: 'cat' })]);
    rebuildIndexOutput(web, data);
    for (const f of ['index.html', 'manual.html', 'words.html', 'manifest.json', 'manual-manifest.json']) {
      assert.ok(fs.existsSync(path.join(web, f)), f);
    }
    assert.deepEqual(manifest()[0].words.map(w => w.word), ['猫']);
    assert.match(read(path.join(web, 'index.html')), /digest-2026-09-01\.html#w1/);
    assert.match(con.log.join('\n'), /index\.html rebuilt \(1 entry\)/);
    assert.match(con.log.join('\n'), /manual\.html rebuilt \(0 entries\)/);
  });

  it('drops manifest entries whose digest file is gone', () => {
    write(path.join(web, 'manifest.json'), JSON.stringify([
      { date: '2026-09-01', wordCount: 1, words: [{ word: '猫', definition: 'cat' }], file: 'digest-2026-09-01.html' },
      { date: '2026-09-02', wordCount: 1, words: [{ word: '犬', definition: 'dog' }], file: 'digest-2026-09-02.html' },
    ]));
    write(path.join(web, 'digest-2026-09-02.html'), 'x');
    rebuildIndexOutput(web, data);
    assert.deepEqual(manifest().map(e => e.date), ['2026-09-02']);
  });

  it('keeps the words stored in the manifest for a digest that still exists', () => {
    write(path.join(web, 'manifest.json'), JSON.stringify([{ date: '2026-09-01', wordCount: 1, words: [{ word: '猫', definition: 'cat' }], file: 'digest-2026-09-01.html' }]));
    write(path.join(web, 'digest-2026-09-01.html'), 'x');
    rebuildIndexOutput(web, data);
    assert.deepEqual(manifest()[0].words, [{ word: '猫', definition: 'cat' }]);
  });

  it('adds an entry with no words for a digest that has no JSON', () => {
    write(path.join(web, 'digest-2026-09-01.html'), 'x');
    rebuildIndexOutput(web, data);
    assert.deepEqual(manifest().map(e => [e.date, e.wordCount, e.words.length]), [['2026-09-01', 0, 0]]);
  });

  it('reads words from a bare-array JSON and from a corrupt one', () => {
    write(path.join(web, 'digest-2026-09-01.html'), 'x');
    write(path.join(web, 'digest-2026-09-02.html'), 'x');
    write(path.join(data, 'words-2026-09-01.json'), JSON.stringify([makeRecord({ word: '猫' })]));
    write(path.join(data, 'words-2026-09-02.json'), '{oops');
    rebuildIndexOutput(web, data);
    assert.deepEqual(manifest().map(e => [e.date, e.wordCount]), [['2026-09-02', 0], ['2026-09-01', 1]]);
  });

  it('rebuilds custom runs from their manifest', () => {
    write(path.join(web, 'manual-manifest.json'), JSON.stringify([{ date: '2026-09-01', wordCount: 1, words: [{ word: '猫', definition: 'cat' }], file: 'digest-2026-09-01.html' }]));
    write(path.join(web, 'digest-2026-09-01.html'), 'x');
    rebuildIndexOutput(web, data);
    assert.deepEqual(manifest('manual-manifest.json').map(e => e.date), ['2026-09-01']);
    assert.match(read(path.join(web, 'manual.html')), /<b lang="ja">猫<\/b> cat/);
  });

  it('drops a custom run whose digest file is gone', () => {
    write(path.join(web, 'manual-manifest.json'), JSON.stringify([{ date: '2026-09-01', wordCount: 1, words: [{ word: '猫', definition: 'cat' }], file: 'digest-2026-09-01.html' }]));
    rebuildIndexOutput(web, data);
    assert.deepEqual(manifest('manual-manifest.json'), []);
  });

  // Known bug, kept as todos so they show up in the report without failing the suite: any
  // digest-*.html that is not in manifest.json is treated as an automatic run, including the
  // pages of custom runs (which live in manual-manifest.json). html.ts keeps the two apart
  // when it links neighbouring days; the index code does not.
  const leak = { todo: 'digest files of custom runs are imported into the automatic manifest' };
  const customRun = () => {
    write(path.join(web, 'manual-manifest.json'), JSON.stringify([{ date: '2026-09-01', wordCount: 1, words: [{ word: '猫', definition: 'cat' }], file: 'digest-2026-09-01.html' }]));
    write(path.join(web, 'digest-2026-09-01.html'), 'x');
    write(path.join(web, 'digest-2026-09-02.html'), 'x');
  };
  it('does not list a custom run as an automatic day when rebuilding', leak, () => {
    customRun();
    rebuildIndexOutput(web, data);
    assert.deepEqual(manifest().map(e => e.date), ['2026-09-02']);
  });
  it('does not list a custom run as an automatic day when writing a daily run', leak, () => {
    customRun();
    writeIndexOutput([makeRecord()], '2026-09-03', web, 'auto', data);
    assert.deepEqual(manifest().map(e => e.date), ['2026-09-03', '2026-09-02']);
  });

  it('shows the empty state when there are no days', () => {
    rebuildIndexOutput(web, data);
    assert.match(read(path.join(web, 'index.html')), /<h1 class="page-title">No days yet<\/h1>/);
    assert.match(read(path.join(web, 'manual.html')), /No custom runs yet/);
  });

  it('is idempotent', () => {
    write(path.join(web, 'digest-2026-09-01.html'), 'x');
    saveWords('2026-09-01');
    rebuildIndexOutput(web, data);
    const first = { index: read(path.join(web, 'index.html')), words: read(path.join(web, 'words.html')), manifest: read(path.join(web, 'manifest.json')) };
    rebuildIndexOutput(web, data);
    assert.equal(read(path.join(web, 'index.html')), first.index);
    assert.equal(read(path.join(web, 'words.html')), first.words);
    assert.equal(read(path.join(web, 'manifest.json')), first.manifest);
  });
});
