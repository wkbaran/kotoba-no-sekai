import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates, getTokenizer, toHiragana, type KuromojiTokenizer } from '../src/tokenizer';
import { cleanupTmpDirs, fakeTokenizer, tmpDir } from './helpers';

type Tok = Parameters<typeof fakeTokenizer>[0] extends Array<infer T> | undefined ? T : never;

const candidates = (tokens: Tok[], minLength = 2) => extractCandidates('ignored', fakeTokenizer(tokens), minLength);
const noun = (surface: string, extra: Tok = {}): Tok =>
  ({ surface_form: surface, pos: '名詞', pos_detail_1: '一般', basic_form: surface, reading: surface, ...extra });

describe('toHiragana', () => {
  it('converts katakana to hiragana', () => {
    assert.equal(toHiragana('タベル'), 'たべる');
    assert.equal(toHiragana('ガッコウ'), 'がっこう');
    assert.equal(toHiragana('ヴ'), 'ゔ');
  });

  it('leaves everything else alone', () => {
    assert.equal(toHiragana('たべる'), 'たべる');
    assert.equal(toHiragana('食べる'), '食べる');
    assert.equal(toHiragana('abc123'), 'abc123');
    assert.equal(toHiragana(''), '');
  });

  it('keeps the long-vowel mark', () => {
    assert.equal(toHiragana('コーヒー'), 'こーひー');
  });
});

describe('extractCandidates: part of speech', () => {
  it('keeps nouns, verbs and adjectives', () => {
    const got = candidates([
      noun('公園'),
      { surface_form: '走っ', pos: '動詞', pos_detail_1: '自立', basic_form: '走る', reading: 'ハシッ' },
      { surface_form: '新しい', pos: '形容詞', pos_detail_1: '自立', basic_form: '新しい', reading: 'アタラシイ' },
      { surface_form: '静か', pos: '形容動詞', pos_detail_1: '*', basic_form: '静か', reading: 'シズカ' },
    ]);
    assert.deepEqual(got.map(c => c.baseForm), ['公園', '走る', '新しい', '静か']);
    assert.deepEqual(got.map(c => c.pos), ['名詞', '動詞', '形容詞', '形容動詞']);
  });

  it('drops particles, auxiliaries, symbols and adverbs', () => {
    const got = candidates(['助詞', '助動詞', '記号', '副詞', '接続詞', '連体詞', '感動詞', '接頭詞'].map(pos => noun('ああああ', { pos })));
    assert.deepEqual(got, []);
  });

  it('drops the unhelpful noun subtypes', () => {
    for (const sub of ['数', '接尾', '非自立', '代名詞', 'サ変接続']) {
      assert.deepEqual(candidates([noun('あいう', { pos_detail_1: sub })]), [], sub);
    }
  });

  it('applies the subtype filter to nouns only', () => {
    const got = candidates([{ surface_form: '食べる', pos: '動詞', pos_detail_1: '非自立', basic_form: '食べる', reading: 'タベル' }]);
    assert.equal(got.length, 1);
  });
});

describe('extractCandidates: fields', () => {
  it('reports surface, base form, hiragana reading and part of speech', () => {
    const [c] = candidates([{ surface_form: '読み', pos: '動詞', basic_form: '読む', reading: 'ヨミ' }]);
    assert.deepEqual(c, { surface: '読み', baseForm: '読む', reading: 'よみ', pos: '動詞' });
  });

  it('falls back to the surface when there is no base form', () => {
    const [c] = candidates([noun('タワー', { basic_form: '*' })]);
    assert.equal(c.baseForm, 'タワー');
    const [d] = candidates([noun('タワー', { basic_form: undefined })]);
    assert.equal(d.baseForm, 'タワー');
  });

  it('falls back to the surface, as hiragana, when there is no reading', () => {
    const [c] = candidates([noun('タワー', { reading: '*' })]);
    assert.equal(c.reading, 'たわー');
    const [d] = candidates([noun('東京', { reading: undefined })]);
    assert.equal(d.reading, '東京');
  });
});

describe('extractCandidates: filters', () => {
  it('drops surfaces shorter than the minimum length', () => {
    const tokens = [noun('本'), noun('公園')];
    assert.deepEqual(candidates(tokens, 2).map(c => c.surface), ['公園']);
    assert.deepEqual(candidates(tokens, 1).map(c => c.surface), ['本', '公園']);
    assert.deepEqual(candidates(tokens, 3), []);
  });

  it('measures the surface, not the base form', () => {
    const got = candidates([{ surface_form: '走っ', pos: '動詞', basic_form: '走る', reading: 'ハシッ' }], 2);
    assert.equal(got.length, 1);
  });

  it('skips common grammar words by base form', () => {
    const skip = ['する', 'ある', 'いる', 'なる', 'れる', 'られる', 'せる', 'させる', 'ない', 'です', 'ます', 'こと', 'もの', 'ため', 'よう', 'とき', 'ところ', 'わけ'];
    const tokens = skip.map(b => ({ surface_form: b + 'ー', pos: '動詞', basic_form: b, reading: b }));
    assert.deepEqual(candidates(tokens), []);
  });

  it('skips a conjugated form of a skipped verb', () => {
    assert.deepEqual(candidates([{ surface_form: 'して', pos: '動詞', basic_form: 'する', reading: 'シテ' }]), []);
  });

  it('skips ASCII and numeric tokens', () => {
    assert.deepEqual(candidates([noun('ABC'), noun('2026'), noun('a1 b2'), noun('AI')]), []);
  });

  it('keeps mixed and full-width tokens', () => {
    assert.deepEqual(candidates([noun('ＡＢＣ'), noun('5号')]).map(c => c.surface), ['ＡＢＣ', '5号']);
  });

  it('dedupes by base form, keeping the first surface', () => {
    const got = candidates([
      { surface_form: '走っ', pos: '動詞', basic_form: '走る', reading: 'ハシッ' },
      { surface_form: '走り', pos: '動詞', basic_form: '走る', reading: 'ハシリ' },
      noun('公園'),
      noun('公園'),
    ]);
    assert.deepEqual(got.map(c => c.surface), ['走っ', '公園']);
  });

  it('returns nothing for no tokens', () => {
    assert.deepEqual(candidates([]), []);
  });
});

// Must run before anything loads the real tokenizer: getTokenizer caches its first success.
describe('getTokenizer: missing dictionary', () => {
  it('rejects with a clear message, and works once the dictionary can be found', async () => {
    const cwd = process.cwd();
    process.chdir(tmpDir()); // the dictionary path is resolved from the working directory
    try {
      await assert.rejects(getTokenizer(), /Kuromoji failed to initialize/);
    } finally {
      process.chdir(cwd);
      cleanupTmpDirs();
    }
    assert.ok(await getTokenizer(), 'a failure is not cached');
  });
});

describe('with the real kuromoji dictionary', () => {
  let tokenizer: KuromojiTokenizer;
  before(async () => { tokenizer = await getTokenizer(); });

  it('is a singleton', async () => {
    assert.equal(await getTokenizer(), tokenizer);
  });

  it('extracts content words from a sentence', () => {
    const got = extractCandidates('私は毎日新しい本を読みます。静かな公園で犬が走っている。', tokenizer, 2);
    const byBase = new Map(got.map(c => [c.baseForm, c]));
    assert.deepEqual(byBase.get('読む'), { surface: '読み', baseForm: '読む', reading: 'よみ', pos: '動詞' });
    assert.equal(byBase.get('新しい')?.pos, '形容詞');
    assert.equal(byBase.get('公園')?.reading, 'こうえん');
    assert.ok(byBase.has('毎日'));
    assert.ok(byBase.has('走る'), 'conjugated 走っ is reported by its dictionary form');
  });

  it('leaves out particles, one-character words and grammar verbs', () => {
    const bases = extractCandidates('私は本を読んでいます。', tokenizer, 2).map(c => c.baseForm);
    assert.ok(!bases.includes('は'));
    assert.ok(!bases.includes('本'), 'single-character surface');
    assert.ok(!bases.includes('いる'));
    assert.ok(!bases.includes('ます'));
  });

  it('does not offer numbers or half-width text', () => {
    const bases = extractCandidates('2026年に123人がABCを見た。', tokenizer, 2).map(c => c.baseForm);
    assert.ok(!bases.includes('2026'));
    assert.ok(!bases.includes('123'));
    assert.ok(!bases.includes('ABC'));
  });

  it('returns nothing for empty text', () => {
    assert.deepEqual(extractCandidates('', tokenizer, 2), []);
  });
});
