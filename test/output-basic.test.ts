import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { buildAnkiNote, writeJsonOutput } from '../src/output/json';
import { writeMarkdownOutput } from '../src/output/markdown';
import { ATTRIBUTION_CSS, ATTRIBUTION_HTML, ATTRIBUTION_MARKDOWN } from '../src/output/attribution';
import {
  BASE_CSS, WADA_PRESETS, asDate, esc, hasCustomRuns, longDate, pageHead, shortDate, siteFooter, siteHeader,
} from '../src/output/theme';
import { captureConsole, cleanupTmpDirs, makeExample, makeRecord, read, tmpDir, write, type Captured } from './helpers';

let con: Captured;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { con.restore(); cleanupTmpDirs(); });

describe('buildAnkiNote', () => {
  it('builds a Basic note from a record', () => {
    const note = buildAnkiNote(makeRecord({
      examples: [makeExample({ markedHtml: '一<mark>猫</mark>' }), makeExample({ markedHtml: '二<mark>猫</mark>' })],
      word: '猫', reading: 'ねこ', definition: 'cat', jlptLevel: 'N4', domain: 'science', sourceUrl: 'https://example.com/x',
    }));
    assert.deepEqual(note, {
      noteType: 'Basic',
      fields: {
        Front: '猫【ねこ】',
        Back: 'cat',
        Example: '一<mark>猫</mark><br><br>二<mark>猫</mark>',
        Source: 'https://example.com/x',
        Level: 'N4',
        Domain: 'science',
      },
    });
  });

  it('leaves the example field empty when there are no examples', () => {
    assert.equal(buildAnkiNote(makeRecord({ examples: [] })).fields.Example, '');
  });

  it('uses only the primary definition on the back', () => {
    assert.equal(buildAnkiNote(makeRecord({ definition: 'to eat', altDefinitions: ['to live on'] })).fields.Back, 'to eat');
  });
});

describe('writeJsonOutput', () => {
  it('writes words-<date>.json and returns its path', () => {
    const dir = tmpDir();
    const out = writeJsonOutput([makeRecord()], '2026-09-01', dir);
    assert.equal(out, path.join(dir, 'words-2026-09-01.json'));
    const data = JSON.parse(read(out));
    assert.deepEqual(data.meta, { date: '2026-09-01', wordCount: 1, generator: 'kotoba-no-sekai' });
    assert.equal(data.ankiNotes.length, 1);
    assert.equal(data.ankiNotes[0].fields.Front, '食べる【たべる】');
    assert.deepEqual(data.fullRecords, [makeRecord()]);
  });

  it('round-trips records losslessly', () => {
    const records = [makeRecord(), makeRecord({ word: '猫', reading: 'ねこ', altDefinitions: [], examples: [] })];
    const data = JSON.parse(read(writeJsonOutput(records, '2026-09-01', tmpDir())));
    assert.deepEqual(data.fullRecords, records);
    assert.equal(data.meta.wordCount, 2);
  });

  it('includes the review word in the payload but not in the Anki notes', () => {
    const review = makeRecord({ word: '飲む', reading: 'のむ' });
    const data = JSON.parse(read(writeJsonOutput([makeRecord()], '2026-09-01', tmpDir(), review)));
    assert.deepEqual(data.reviewWord, review);
    assert.equal(data.ankiNotes.length, 1);
    assert.equal(data.fullRecords.length, 1);
    assert.equal(data.meta.wordCount, 1);
  });

  it('omits reviewWord entirely when there is none', () => {
    const data = JSON.parse(read(writeJsonOutput([makeRecord()], '2026-09-01', tmpDir())));
    assert.ok(!('reviewWord' in data));
  });

  it('writes valid, pretty-printed UTF-8', () => {
    const text = read(writeJsonOutput([makeRecord()], '2026-09-01', tmpDir()));
    assert.ok(text.includes('食べる'), 'not escaped');
    assert.ok(text.includes('\n  "meta"'), 'indented');
  });

  it('handles no records', () => {
    const data = JSON.parse(read(writeJsonOutput([], '2026-09-01', tmpDir())));
    assert.equal(data.meta.wordCount, 0);
    assert.deepEqual(data.ankiNotes, []);
  });

  it('overwrites an existing file for the same date', () => {
    const dir = tmpDir();
    writeJsonOutput([makeRecord()], '2026-09-01', dir);
    const out = writeJsonOutput([makeRecord(), makeRecord({ word: '猫' })], '2026-09-01', dir);
    assert.equal(JSON.parse(read(out)).meta.wordCount, 2);
  });
});

describe('writeMarkdownOutput', () => {
  const md = (records = [makeRecord()], review: ReturnType<typeof makeRecord> | null = null) =>
    read(writeMarkdownOutput(records, '2026-09-01', tmpDir(), review));

  it('writes digest-<date>.md and returns its path', () => {
    const dir = tmpDir();
    assert.equal(writeMarkdownOutput([makeRecord()], '2026-09-01', dir), path.join(dir, 'digest-2026-09-01.md'));
  });

  it('has a dated title and a count', () => {
    const text = md();
    assert.match(text, /^# 言葉の世界 — 2026-09-01\n/);
    assert.match(text, /\*1 new word collected\*/);
  });

  it('pluralises the count', () => {
    assert.match(md([makeRecord(), makeRecord({ word: '猫' })]), /\*2 new words collected\*/);
    assert.match(md([]), /\*0 new words collected\*/);
  });

  it('notes the review word', () => {
    assert.match(md([makeRecord()], makeRecord({ word: '飲む', reading: 'のむ' })), /\*1 new word collected, plus 1 for review\*/);
  });

  it('numbers each word with its reading', () => {
    const text = md([makeRecord(), makeRecord({ word: '猫', reading: 'ねこ' })]);
    assert.match(text, /## 1\. 食べる【たべる】/);
    assert.match(text, /## 2\. 猫【ねこ】/);
  });

  it('gives the definition, alternatives (three at most), level and domain', () => {
    const text = md([makeRecord({ altDefinitions: ['a', 'b', 'c', 'd'], jlptLevel: 'N3', domain: 'science' })]);
    assert.match(text, /to eat/);
    assert.match(text, /\*Also:\* a; b; c\n/);
    assert.ok(!text.includes('; d'));
    assert.match(text, /> \*\*Level:\*\* N3 · \*\*Domain:\*\* science/);
  });

  it('omits the "Also" line when there are no alternatives', () => {
    assert.ok(!md([makeRecord({ altDefinitions: [] })]).includes('*Also:*'));
  });

  it('quotes each example with the word in bold and a source link', () => {
    const text = md([makeRecord({ examples: [makeExample({ plain: '毎日ご飯を食べるのが好きです。食べる', sourceUrl: 'https://example.com/a#x' })] })]);
    assert.match(text, /> 毎日ご飯を\*\*食べる\*\*のが好きです。\*\*食べる\*\*/);
    assert.match(text, /> — \[Source\]\(https:\/\/example\.com\/a#x\)/);
    assert.match(text, /\*\*Example from source:\*\*/);
  });

  it('omits the examples block when there are none', () => {
    assert.ok(!md([makeRecord({ examples: [] })]).includes('Example from source'));
  });

  it('treats regex characters in the word literally', () => {
    const text = md([makeRecord({ word: 'C++', reading: 'しーぷらぷら', examples: [makeExample({ plain: 'I use C++ daily. C++ is fun.' })] })]);
    assert.match(text, /> I use \*\*C\+\+\*\* daily\. \*\*C\+\+\*\* is fun\./);
  });

  it('adds the review word as its own section', () => {
    const text = md([makeRecord()], makeRecord({ word: '飲む', reading: 'のむ' }));
    assert.match(text, /## 📖 Review: 飲む【のむ】/);
    assert.ok(text.indexOf('## 1.') < text.indexOf('Review: 飲む'));
  });

  it('ends with a credit line and the dictionary attribution', () => {
    const text = md();
    assert.match(text, /\*Generated by \[Kotoba no Sekai\]\(https:\/\/github\.com\/wkbaran\/kotoba-no-sekai\) on 2026-09-01\*/);
    assert.ok(text.endsWith(ATTRIBUTION_MARKDOWN));
  });

  describe('part-of-speech labels', () => {
    const label = (pos: string) => md([makeRecord({ pos, definition: 'DEF' })]).match(/\*\*(.*?)\*\* DEF/)?.[1];

    it('abbreviates nouns, verbs and adjectives', () => {
      assert.equal(label('Noun'), 'n.');
      assert.equal(label('Godan verb with \'u\' ending'), 'v.');
      assert.equal(label('Ichidan verb'), 'v.');
      assert.equal(label('Adjective'), 'adj.');
    });

    it('is case-insensitive', () => {
      assert.equal(label('noun'), 'n.');
    });

    it('passes through a part of speech it does not know', () => {
      assert.equal(label('Expression'), 'Expression');
      assert.equal(label('Conjunction'), 'Conjunction');
    });

    // The table is matched in order by substring, so specific names must beat general ones:
    // "Adverb" contains "verb", and "Na-adjective" contains "adjective".
    it('labels an adverb "adv."', () => assert.equal(label('Adverb (fukushi)'), 'adv.'));
    it('labels an adverb taking a particle "adv."', () => assert.equal(label("Adverb taking the 'to' particle"), 'adv.'));
    it('labels a suru verb "v. (suru)"', () => assert.equal(label('Suru verb - included'), 'v. (suru)'));
    it('labels a な-adjective "adj. (な)"', () => assert.equal(label('Na-adjective (keiyodoshi)'), 'adj. (な)'));
    it('labels an い-adjective "adj. (い)"', () => assert.equal(label('I-adjective (keiyoushi)'), 'adj. (い)'));
  });
});

describe('attribution', () => {
  it('credits JMdict/EDICT, the EDRDG and its licence, Jisho and the JLPT lists (HTML)', () => {
    assert.match(ATTRIBUTION_HTML, /class="attribution"/);
    assert.match(ATTRIBUTION_HTML, /href="https:\/\/www\.edrdg\.org\/wiki\/index\.php\/JMdict-EDICT_Dictionary_Project">JMdict\/EDICT</);
    assert.match(ATTRIBUTION_HTML, /href="https:\/\/www\.edrdg\.org\/">Electronic Dictionary Research and Development Group</);
    assert.match(ATTRIBUTION_HTML, /href="https:\/\/www\.edrdg\.org\/edrdg\/licence\.html">licence</);
    assert.match(ATTRIBUTION_HTML, /href="https:\/\/jisho\.org\/">Jisho\.org</);
    assert.match(ATTRIBUTION_HTML, /href="https:\/\/www\.tanos\.co\.uk\/jlpt\/">Jonathan Waller's JLPT Resources</);
  });

  it('carries the same credits in Markdown', () => {
    for (const url of ['JMdict-EDICT_Dictionary_Project', 'https://www.edrdg.org/)', 'licence.html', 'https://jisho.org/', 'tanos.co.uk/jlpt']) {
      assert.ok(ATTRIBUTION_MARKDOWN.includes(url), url);
    }
    assert.ok(ATTRIBUTION_MARKDOWN.startsWith('*') && ATTRIBUTION_MARKDOWN.endsWith('*'));
  });

  it('exports CSS for the paragraph', () => {
    assert.match(ATTRIBUTION_CSS, /\.attribution/);
  });
});

describe('theme helpers', () => {
  it('esc escapes HTML-significant characters', () => {
    assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('esc escapes & before the others, so entities are not double-decoded', () => {
    assert.equal(esc('&lt;'), '&amp;lt;');
  });

  it('esc treats null and undefined as empty, and stringifies other values', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(''), '');
    assert.equal(esc(5 as never), '5');
  });

  it('asDate reads YYYY-MM-DD and YYYY-MM-DD-N ids at local noon', () => {
    for (const id of ['2026-09-01', '2026-09-01-2']) {
      const d = asDate(id);
      assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 8, 1, 12]);
    }
  });

  it('longDate and shortDate format ids in English', () => {
    assert.equal(longDate('2026-09-01'), 'Tuesday, September 1, 2026');
    assert.equal(longDate('2026-12-25-3'), 'Friday, December 25, 2026');
    assert.equal(shortDate('2026-09-01'), 'Sep 1');
    assert.equal(shortDate('2026-09-01-2'), 'Sep 1, run 2');
    assert.equal(shortDate('2026-09-01-12'), 'Sep 1, run 12');
  });

  describe('hasCustomRuns', () => {
    const manifest = (content: string) => { const dir = tmpDir(); write(path.join(dir, 'manual-manifest.json'), content); return dir; };
    it('is true when the manual manifest has entries', () => assert.equal(hasCustomRuns(manifest('[{"date":"2026-09-01"}]')), true));
    it('is false for an empty manifest', () => assert.equal(hasCustomRuns(manifest('[]')), false));
    it('is false for a corrupt manifest', () => assert.equal(hasCustomRuns(manifest('{oops')), false));
    it('is false when there is no manifest', () => assert.equal(hasCustomRuns(tmpDir()), false));
    it('is false when the directory does not exist', () => assert.equal(hasCustomRuns(path.join(tmpDir(), 'nope')), false));
  });

  it('WADA_PRESETS are well-formed', () => {
    assert.ok(WADA_PRESETS.length >= 1);
    assert.equal(new Set(WADA_PRESETS.map(p => p.no)).size, WADA_PRESETS.length, 'unique numbers');
    for (const p of WADA_PRESETS) {
      assert.equal(p.colors.length, 3);
      assert.equal(p.names.length, 3);
      for (const c of p.colors) assert.match(c, /^#[0-9a-f]{6}$/i);
    }
  });

  it('pageHead sets the charset, viewport and an escaped title', () => {
    const head = pageHead('言葉 <b> & "x"');
    assert.match(head, /<meta charset="UTF-8">/);
    assert.match(head, /name="viewport"/);
    assert.match(head, /<title>言葉 &lt;b&gt; &amp; &quot;x&quot;<\/title>/);
    assert.match(head, /<script>/, 'palette script');
    assert.ok(head.includes('#112f2c'), 'default palette colours');
  });

  it('BASE_CSS defines the colour tokens for light and dark', () => {
    assert.match(BASE_CSS, /--ground/);
    assert.match(BASE_CSS, /data-theme="light"/);
  });

  describe('siteHeader', () => {
    it('links the three pages and marks the current one', () => {
      const html = siteHeader('words', true);
      assert.match(html, /<a href="index\.html">Days<\/a>/);
      assert.match(html, /<a href="words\.html" aria-current="page">All words<\/a>/);
      assert.match(html, /<a href="manual\.html">Custom<\/a>/);
      assert.equal((html.match(/aria-current/g) ?? []).length, 1);
    });

    it('hides the Custom link unless asked', () => {
      assert.ok(!siteHeader('days', false).includes('manual.html'));
    });

    it('marks nothing on a digest page', () => {
      assert.ok(!siteHeader(null, false).includes('aria-current'));
    });

    it('prefixes links with a base path', () => {
      const html = siteHeader('days', true, '../');
      assert.match(html, /href="\.\.\/index\.html"/);
      assert.match(html, /href="\.\.\/manual\.html"/);
    });
  });

  it('siteFooter carries the note and the attribution', () => {
    const html = siteFooter('A note');
    assert.match(html, /<p>A note<\/p>/);
    assert.ok(html.includes(ATTRIBUTION_HTML));
  });
});
