import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { annotateFurigana, findExamples, splitSentences } from '../src/sentences';
import { getTokenizer, type KuromojiTokenizer } from '../src/tokenizer';
import { fakeTokenizer } from './helpers';

describe('splitSentences', () => {
  it('splits after Japanese sentence-ending punctuation and keeps it', () => {
    assert.deepEqual(splitSentences('今日は天気がとても良いです。明日は雨が降るでしょう。'), [
      '今日は天気がとても良いです。', '明日は雨が降るでしょう。',
    ]);
  });

  it('splits on ！ ？ and …', () => {
    assert.deepEqual(splitSentences('本当に驚きましたよ！どうしてそうなったの？わかりませんでした…'), [
      '本当に驚きましたよ！', 'どうしてそうなったの？', 'わかりませんでした…',
    ]);
  });

  it('does not split on ASCII punctuation', () => {
    assert.deepEqual(splitSentences('This is English. And so is this one!'), ['This is English. And so is this one!']);
  });

  it('swallows whitespace after the punctuation', () => {
    assert.deepEqual(splitSentences('今日は天気がとても良いです。 \n 明日は雨が降るでしょう。'), [
      '今日は天気がとても良いです。', '明日は雨が降るでしょう。',
    ]);
  });

  it('never crosses a blank line', () => {
    assert.deepEqual(splitSentences('今日は天気がとても良いです\n\n明日は雨が降るでしょう'), [
      '今日は天気がとても良いです', '明日は雨が降るでしょう',
    ]);
  });

  it('does not split on a single newline', () => {
    assert.deepEqual(splitSentences('今日は天気が\nとても良いです'), ['今日は天気が\nとても良いです']);
  });

  it('drops fragments under 10 characters', () => {
    assert.deepEqual(splitSentences('はい。今日は天気がとても良いです。'), ['今日は天気がとても良いです。']);
    assert.deepEqual(splitSentences('あ'.repeat(9)), []);
    assert.equal(splitSentences('あ'.repeat(10)).length, 1);
  });

  it('drops sentences over 300 characters', () => {
    assert.equal(splitSentences('あ'.repeat(299) + '。').length, 1);
    assert.deepEqual(splitSentences('あ'.repeat(300) + '。'), []);
  });

  it('handles empty input', () => {
    assert.deepEqual(splitSentences(''), []);
    assert.deepEqual(splitSentences('\n\n\n'), []);
  });
});

describe('findExamples', () => {
  const tok = fakeTokenizer();
  const find = (text: string, surface: string, word = surface, max = 2, articleText = '') =>
    findExamples(text, surface, word, 'https://example.com/a', tok, articleText, max);

  it('returns nothing when the word is absent', () => {
    assert.deepEqual(find('今日は天気がとても良いです。', '猫'), []);
  });

  it('builds an example with the word marked', () => {
    const [ex] = find('毎日ご飯を食べるのが好きです。', '食べる');
    assert.equal(ex.plain, '毎日ご飯を食べるのが好きです。');
    assert.equal(ex.markedHtml, '毎日ご飯を<mark>食べる</mark>のが好きです。');
    // The fake tokenizer emits one token per character, so ruby sits inside the mark.
    assert.match(ex.glossedHtml, /<mark>.*食.*べる<\/mark>/);
  });

  it('links to the article with a text fragment for the matched word', () => {
    const [ex] = find('毎日ご飯を食べるのが好きです。', '食べる');
    assert.equal(ex.sourceUrl, `https://example.com/a#:~:text=${encodeURIComponent('食べる')}`);
  });

  it('carries the archived article text', () => {
    const [ex] = find('毎日ご飯を食べるのが好きです。', '食べる', '食べる', 2, 'backup text');
    assert.equal(ex.articleText, 'backup text');
  });

  it('respects the maximum count', () => {
    const text = '猫が庭で遊んでいます。猫が魚を食べています。猫が屋根で寝ています。';
    assert.equal(find(text, '猫', '猫', 2).length, 2);
    assert.equal(find(text, '猫', '猫', 1).length, 1);
    assert.equal(find(text, '猫', '猫', 5).length, 3);
    assert.deepEqual(find(text, '猫', '猫', 0), []);
  });

  it('returns sentences in article order, skipping those without the word', () => {
    const text = '猫が庭で遊んでいます。犬が公園で走っています。猫が屋根で寝ています。';
    assert.deepEqual(find(text, '猫').map(e => e.plain), ['猫が庭で遊んでいます。', '猫が屋根で寝ています。']);
  });

  it('matches the surface form as it appeared', () => {
    const [ex] = find('彼は昨日ご飯を食べました。', '食べ', '食べる');
    assert.match(ex.markedHtml, /<mark>食べ<\/mark>/);
  });

  it('also matches the canonical word when the surface is absent', () => {
    const [ex] = find('彼はいつもご飯を食べるのです。', '食べて', '食べる');
    assert.match(ex.markedHtml, /<mark>食べる<\/mark>/);
  });

  it('prefers the surface form when both appear', () => {
    const [ex] = find('食べるのは食べてからです、と彼は言いました。', '食べて', '食べる');
    assert.match(ex.markedHtml, /<mark>食べて<\/mark>/);
  });

  it('marks only the first occurrence in a sentence', () => {
    const [ex] = find('猫は猫として生きていきます。', '猫');
    assert.equal(ex.markedHtml, '<mark>猫</mark>は猫として生きていきます。');
  });

  it('escapes HTML in the marked and glossed versions but not in plain', () => {
    const [ex] = find('猫は<b>"魚"</b>と&\'肉\'を食べます。', '猫');
    assert.equal(ex.plain, '猫は<b>"魚"</b>と&\'肉\'を食べます。');
    assert.ok(!ex.markedHtml.includes('<b>'));
    assert.match(ex.markedHtml, /&lt;b&gt;&quot;魚&quot;&lt;\/b&gt;と&amp;&#39;肉&#39;/);
    assert.ok(!ex.glossedHtml.includes('<b>'));
  });

  it('escapes a target that contains special characters', () => {
    const [ex] = find('これはA&Bという名前のお店です。', 'A&B');
    assert.equal(ex.markedHtml, 'これは<mark>A&amp;B</mark>という名前のお店です。');
  });

  it('skips sentences that are too short', () => {
    assert.deepEqual(find('猫だ。', '猫'), []);
  });

  it('does not search across paragraphs', () => {
    assert.deepEqual(find('猫が庭で遊んでいま\n\nす、と彼は話しました。', '猫がす'), []);
  });
});

describe('findExamples: long sentences', () => {
  const tok = fakeTokenizer();
  // Ten 19-character clauses (each a distinct character), joined by 、: 199 characters.
  const clause = (i: number) => String.fromCharCode(0x3042 + i * 2).repeat(19);
  const clauses = Array.from({ length: 10 }, (_, i) => clause(i));
  const withTarget = (i: number) => clauses.map((c, k) => (k === i ? c.slice(0, -1) + '猫' : c));
  const run = (i: number) => findExamples(withTarget(i).join('、'), '猫', '猫', 'https://x', tok, '', 1)[0];

  it('trims a long sentence to clauses around the word', () => {
    const ex = run(5);
    assert.ok(ex.plain.length <= 120, `length ${ex.plain.length}`);
    assert.ok(ex.plain.includes('猫'));
    assert.ok(withTarget(5).join('、').includes(ex.plain), 'a contiguous slice of the sentence');
    assert.match(ex.markedHtml, /<mark>猫<\/mark>/);
  });

  it('balances context on both sides of the word', () => {
    const ex = run(5);
    const parts = ex.plain.split('、');
    const at = parts.findIndex(p => p.includes('猫'));
    assert.ok(at > 0 && at < parts.length - 1, `word at clause ${at} of ${parts.length}`);
    assert.ok(Math.abs(at - (parts.length - 1 - at)) <= 1, 'roughly equal clauses each side');
  });

  it('grows only forward when the word is in the first clause', () => {
    const ex = run(0);
    assert.ok(ex.plain.startsWith(withTarget(0)[0]));
    assert.ok(ex.plain.length <= 120);
    assert.ok(ex.plain.split('、').length > 1);
  });

  it('grows only backward when the word is in the last clause', () => {
    const ex = run(9);
    assert.ok(ex.plain.endsWith(withTarget(9)[9]));
    assert.ok(ex.plain.length <= 120);
  });

  it('records the trimmed clause as the example, not the whole sentence', () => {
    const sentence = withTarget(5).join('、');
    const ex = run(5);
    assert.ok(ex.plain.length < sentence.length);
  });

  describe('uneven clause lengths', () => {
    const big = 'あ'.repeat(115);
    const small = (c: string) => c.repeat(5);
    const T = '猫' + 'う'.repeat(9);
    const trim = (parts: string[]) => findExamples(parts.join('、'), '猫', '猫', 'https://x', tok, '', 1)[0].plain;

    it('skips a long neighbour that will not fit and takes the short ones on the other side', () => {
      assert.equal(trim([big, T, small('い'), small('え')]), [T, small('い'), small('え')].join('、'));
    });

    it('skips a long following clause and takes the short ones before', () => {
      assert.equal(trim([small('い'), small('え'), T, big]), [small('い'), small('え'), T].join('、'));
    });

    it('stops when neither neighbour fits', () => {
      const wide = 'い'.repeat(60);
      const plain = trim([wide, T + 'う'.repeat(40), wide]);
      assert.ok(plain.includes('猫'));
      assert.ok(plain.length <= 120, `length ${plain.length}`);
    });
  });

  it('keeps a long sentence whole when it has no 、', () => {
    const sentence = 'あ'.repeat(150) + '猫' + 'い'.repeat(50) + '。';
    const [ex] = findExamples(sentence, '猫', '猫', 'https://x', tok, '', 1);
    assert.equal(ex.plain, sentence);
  });

  it('keeps a sentence whole when the word spans a 、', () => {
    const sentence = 'あ'.repeat(70) + '、' + 'い'.repeat(70) + '。';
    const [ex] = findExamples(sentence, 'あ、い', 'あ、い', 'https://x', tok, '', 1);
    assert.equal(ex.plain, sentence);
  });

  it('leaves a sentence of 120 characters or fewer untouched', () => {
    const sentence = ['あ'.repeat(30), 'い'.repeat(30), '猫' + 'う'.repeat(28), 'え'.repeat(28)].join('、');
    assert.ok(sentence.length <= 120);
    const [ex] = findExamples(sentence, '猫', '猫', 'https://x', tok, '', 1);
    assert.equal(ex.plain, sentence);
  });
});

describe('annotateFurigana (fake tokens)', () => {
  const tokens = (...t: Array<[surface: string, reading?: string]>): KuromojiTokenizer =>
    fakeTokenizer(t.map(([surface_form, reading]) => ({ surface_form, reading: reading ?? '*' })));
  const translate = (s: string) => `https://translate.google.com/?sl=ja&tl=en&text=${encodeURIComponent(s)}&op=translate`;

  it('wraps a kanji token in ruby with a hiragana reading and a lookup link', () => {
    const html = annotateFurigana('猫が', '無関係', tokens(['猫', 'ネコ'], ['が', 'ガ']));
    assert.equal(
      html,
      `<a href="${translate('猫')}" target="_blank" rel="noopener" class="gloss-link">` +
      '<ruby data-reading="ねこ">猫<rt>ねこ</rt></ruby></a>が',
    );
  });

  it('leaves kana tokens plain and unlinked', () => {
    assert.equal(annotateFurigana('ですが', '無関係', tokens(['です', 'デス'], ['が', 'ガ'])), 'ですが');
  });

  it('marks the target instead of linking it, keeping its furigana', () => {
    const html = annotateFurigana('猫が', '猫', tokens(['猫', 'ネコ'], ['が', 'ガ']));
    assert.equal(html, '<mark><ruby data-reading="ねこ">猫<rt>ねこ</rt></ruby></mark>が');
  });

  it('wraps a target that spans several tokens in one mark', () => {
    const html = annotateFurigana('食べている', '食べて', tokens(['食べ', 'タベ'], ['て', 'テ'], ['いる', 'イル']));
    assert.equal(html, '<mark><ruby data-reading="たべ">食べ<rt>たべ</rt></ruby>て</mark>いる');
    assert.equal((html.match(/<mark>/g) ?? []).length, 1);
  });

  it('still links kanji tokens either side of the target', () => {
    const html = annotateFurigana('犬と猫と鳥', '猫', tokens(['犬', 'イヌ'], ['と', 'ト'], ['猫', 'ネコ'], ['と', 'ト'], ['鳥', 'トリ']));
    assert.equal((html.match(/class="gloss-link"/g) ?? []).length, 2);
    assert.match(html, /<mark><ruby[^>]*>猫/);
  });

  it('flushes a mark that runs to the end of the clause', () => {
    const html = annotateFurigana('犬と猫', '猫', tokens(['犬', 'イヌ'], ['と', 'ト'], ['猫', 'ネコ']));
    assert.ok(html.endsWith('</mark>'));
  });

  it('adds no mark when the target is not in the clause', () => {
    const html = annotateFurigana('猫が', '犬', tokens(['猫', 'ネコ'], ['が', 'ガ']));
    assert.ok(!html.includes('<mark>'));
  });

  it('uses the surface as the reading when there is none', () => {
    const html = annotateFurigana('猫', '無関係', tokens(['猫']));
    assert.match(html, /<ruby data-reading="猫">猫<rt>猫<\/rt><\/ruby>/);
  });

  it('escapes HTML in surfaces and readings', () => {
    const html = annotateFurigana('<>', '無関係', tokens(['<', '<'], ['>', '>']));
    assert.equal(html, '&lt;&gt;');
    const kanji = annotateFurigana('猫', '無関係', tokens(['猫', '"&']));
    assert.match(kanji, /data-reading="&quot;&amp;"/);
  });

  it('returns an empty string for no tokens', () => {
    assert.equal(annotateFurigana('', 'x', tokens()), '');
  });
});

describe('annotateFurigana (real tokenizer)', () => {
  let tokenizer: KuromojiTokenizer;
  before(async () => { tokenizer = await getTokenizer(); });

  const text = (html: string) => html.replace(/<rt>.*?<\/rt>/g, '').replace(/<[^>]+>/g, '');

  it('reproduces the clause once the markup is stripped', () => {
    const clause = '毎日ご飯を食べるのが好きです。';
    assert.equal(text(annotateFurigana(clause, '食べる', tokenizer)), clause);
  });

  it('adds readings for kanji words and marks the target', () => {
    const html = annotateFurigana('毎日ご飯を食べる。', '食べる', tokenizer);
    assert.match(html, /<ruby data-reading="まいにち">毎日<rt>まいにち<\/rt><\/ruby>/);
    assert.match(html, /<mark><ruby data-reading="たべる">食べる<rt>たべる<\/rt><\/ruby><\/mark>/);
    assert.match(html, /class="gloss-link"/);
  });

  it('works end to end through findExamples', () => {
    const [ex] = findExamples('私は毎日ご飯を食べるのが好きです。', '食べる', '食べる', 'https://x', tokenizer, '', 1);
    assert.match(ex.glossedHtml, /<mark>/);
    assert.match(ex.glossedHtml, /<rt>/);
    assert.equal(ex.markedHtml, '私は毎日ご飯を<mark>食べる</mark>のが好きです。');
  });
});
