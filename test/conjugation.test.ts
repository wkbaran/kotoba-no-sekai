import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conjugate, conjugationClass, findForms, type Conjugation } from '../src/conjugation';

/** Plain (or polite) spellings for a form label. */
function forms(word: string, pos: string, label: string, register: 'plain' | 'polite' = 'plain'): string[] {
  const conj = conjugate(word, pos);
  assert.ok(conj, `${word} should have a table`);
  const form = conj.forms.find(f => f.label === label);
  assert.ok(form, `${word} should have a "${label}" form`);
  return form[register] ?? [];
}

describe('conjugationClass', () => {
  const cases: Array<[string, ReturnType<typeof conjugationClass>]> = [
    ['I-adjective (keiyoushi)', 'i-adjective'],
    ['Na-adjective (keiyodoshi)', 'na-adjective'],
    ["Godan verb with 'ku' ending", 'godan'],
    ['Godan verb - Iku/Yuku special', 'godan'],
    ['Ichidan verb', 'ichidan'],
    ['Suru verb - included', 'suru'],
    ['Suru verb - special class', 'suru'],
    ['Kuru verb - special class', 'kuru'],
    ['Ichidan verb - zuru verb (alternative form of -jiru verbs)', null],
    ['Ichidan verb - zuru special', null],
    ['Noun', null],
    ['Adverb', null],
    ['Unknown', null],
  ];
  for (const [pos, expected] of cases) {
    it(`${pos} → ${expected}`, () => assert.equal(conjugationClass(pos), expected));
  }

  it('is case-insensitive and anchored to the start', () => {
    assert.equal(conjugationClass('godan verb with u ending'), 'godan');
    assert.equal(conjugationClass('Expression (godan verb)'), null);
  });
});

describe('conjugate: unsupported input', () => {
  it('returns null for parts of speech without a table', () => {
    assert.equal(conjugate('猫', 'Noun'), null);
  });

  it('returns null when the word does not fit its class', () => {
    assert.equal(conjugate('abc', 'I-adjective'), null);
    assert.equal(conjugate('食べ', 'Ichidan verb'), null);
    assert.equal(conjugate('勉強', 'Suru verb - included'), null);
    assert.equal(conjugate('食べ', 'Kuru verb - special class'), null);
    assert.equal(conjugate('abc', "Godan verb with 'u' ending"), null);
  });
});

describe('ichidan verbs', () => {
  const pos = 'Ichidan verb';
  it('drops る and adds the ending', () => {
    assert.deepEqual(forms('食べる', pos, 'Present'), ['食べる']);
    assert.deepEqual(forms('食べる', pos, 'Present', 'polite'), ['食べます']);
    assert.deepEqual(forms('食べる', pos, 'Negative'), ['食べない']);
    assert.deepEqual(forms('食べる', pos, 'Negative', 'polite'), ['食べません']);
    assert.deepEqual(forms('食べる', pos, 'Past'), ['食べた']);
    assert.deepEqual(forms('食べる', pos, 'Past', 'polite'), ['食べました']);
    assert.deepEqual(forms('食べる', pos, 'Past negative'), ['食べなかった']);
    assert.deepEqual(forms('食べる', pos, 'Te-form'), ['食べて']);
    assert.deepEqual(forms('食べる', pos, 'Volitional'), ['食べよう']);
    assert.deepEqual(forms('食べる', pos, 'Volitional', 'polite'), ['食べましょう']);
    assert.deepEqual(forms('食べる', pos, 'Potential'), ['食べられる']);
    assert.deepEqual(forms('食べる', pos, 'Passive'), ['食べられる']);
    assert.deepEqual(forms('食べる', pos, 'Causative'), ['食べさせる']);
    assert.deepEqual(forms('食べる', pos, 'Conditional'), ['食べれば']);
  });

  it('includes the contracted progressive', () => {
    assert.deepEqual(forms('食べる', pos, 'Progressive'), ['食べている', '食べていた', '食べてる']);
    assert.deepEqual(forms('食べる', pos, 'Progressive', 'polite'), ['食べています', '食べていました']);
  });

  it('drops る again for polite potential, passive and causative', () => {
    assert.deepEqual(forms('食べる', pos, 'Potential', 'polite'), ['食べられます']);
    assert.deepEqual(forms('食べる', pos, 'Passive', 'polite'), ['食べられます']);
    assert.deepEqual(forms('食べる', pos, 'Causative', 'polite'), ['食べさせます']);
  });

  it('describes itself', () => {
    const c = conjugate('見る', pos)!;
    assert.equal(c.cls, 'ichidan');
    assert.equal(c.className, 'ichidan verb');
    assert.match(c.pattern, /ichidan/);
    assert.deepEqual(forms('見る', pos, 'Negative'), ['見ない']);
  });
});

describe('godan verbs', () => {
  const pos = (ending: string) => `Godan verb with '${ending}' ending`;
  const cases: Array<[word: string, ending: string, neg: string, masu: string, ta: string, te: string, vol: string, pot: string, pass: string, caus: string, cond: string]> = [
    ['買う', 'u',  '買わない', '買います', '買った', '買って', '買おう', '買える', '買われる', '買わせる', '買えば'],
    ['書く', 'ku', '書かない', '書きます', '書いた', '書いて', '書こう', '書ける', '書かれる', '書かせる', '書けば'],
    ['泳ぐ', 'gu', '泳がない', '泳ぎます', '泳いだ', '泳いで', '泳ごう', '泳げる', '泳がれる', '泳がせる', '泳げば'],
    ['話す', 'su', '話さない', '話します', '話した', '話して', '話そう', '話せる', '話される', '話させる', '話せば'],
    ['待つ', 'tsu', '待たない', '待ちます', '待った', '待って', '待とう', '待てる', '待たれる', '待たせる', '待てば'],
    ['死ぬ', 'nu', '死なない', '死にます', '死んだ', '死んで', '死のう', '死ねる', '死なれる', '死なせる', '死ねば'],
    ['遊ぶ', 'bu', '遊ばない', '遊びます', '遊んだ', '遊んで', '遊ぼう', '遊べる', '遊ばれる', '遊ばせる', '遊べば'],
    ['読む', 'mu', '読まない', '読みます', '読んだ', '読んで', '読もう', '読める', '読まれる', '読ませる', '読めば'],
    ['帰る', 'ru', '帰らない', '帰ります', '帰った', '帰って', '帰ろう', '帰れる', '帰られる', '帰らせる', '帰れば'],
  ];
  for (const [word, ending, neg, masu, ta, te, vol, pot, pass, caus, cond] of cases) {
    it(`${word} (${ending})`, () => {
      const p = pos(ending);
      assert.deepEqual(forms(word, p, 'Negative'), [neg]);
      assert.deepEqual(forms(word, p, 'Present', 'polite'), [masu]);
      assert.deepEqual(forms(word, p, 'Past'), [ta]);
      assert.deepEqual(forms(word, p, 'Te-form'), [te]);
      assert.deepEqual(forms(word, p, 'Volitional'), [vol]);
      assert.deepEqual(forms(word, p, 'Potential'), [pot]);
      assert.deepEqual(forms(word, p, 'Passive'), [pass]);
      assert.deepEqual(forms(word, p, 'Causative'), [caus]);
      assert.deepEqual(forms(word, p, 'Conditional'), [cond]);
      assert.equal(conjugate(word, p)!.className, 'godan verb');
    });
  }

  it('builds polite past negative from the i-stem', () => {
    assert.deepEqual(forms('書く', pos('ku'), 'Past negative', 'polite'), ['書きませんでした']);
    assert.deepEqual(forms('書く', pos('ku'), 'Past negative'), ['書かなかった']);
  });

  it('行く takes って/った', () => {
    const p = 'Godan verb - Iku/Yuku special';
    assert.deepEqual(forms('行く', p, 'Te-form'), ['行って']);
    assert.deepEqual(forms('行く', p, 'Past'), ['行った']);
    assert.deepEqual(forms('行く', p, 'Negative'), ['行かない']);
    assert.match(conjugate('行く', p)!.pattern, /行って/);
  });

  it('compounds of 行く keep the exception', () => {
    assert.deepEqual(forms('持って行く', 'Godan verb - Iku/Yuku special', 'Te-form'), ['持って行って']);
  });

  it("問う keeps う before て and た", () => {
    const p = "Godan verb with 'u' ending (special class)";
    assert.deepEqual(forms('問う', p, 'Te-form'), ['問うて']);
    assert.deepEqual(forms('問う', p, 'Past'), ['問うた']);
    assert.deepEqual(forms('問う', p, 'Negative'), ['問わない']);
    assert.match(conjugate('問う', p)!.pattern, /keeps う/);
  });

  it('ある has a bare ない negative', () => {
    const p = "Godan verb with 'ru' ending (irregular verb)";
    assert.deepEqual(forms('ある', p, 'Negative'), ['ない']);
    assert.deepEqual(forms('ある', p, 'Past negative'), ['なかった']);
    assert.deepEqual(forms('有る', p, 'Negative'), ['ない']);
    assert.deepEqual(forms('ある', p, 'Past'), ['あった']);
    assert.deepEqual(forms('ある', p, 'Present', 'polite'), ['あります']);
    assert.match(conjugate('ある', p)!.pattern, /ない/);
  });

  it('honorific -aru verbs take い before ます', () => {
    const p = "Godan verb - -aru special class";
    assert.deepEqual(forms('いらっしゃる', p, 'Present', 'polite'), ['いらっしゃいます']);
    assert.deepEqual(forms('くださる', p, 'Negative', 'polite'), ['くださいません']);
    assert.deepEqual(forms('いらっしゃる', p, 'Negative'), ['いらっしゃらない']);
    assert.match(conjugate('いらっしゃる', p)!.pattern, /いらっしゃいます/);
  });
});

describe('する verbs', () => {
  const pos = 'Suru verb - included';
  it('conjugates 勉強する like する', () => {
    assert.deepEqual(forms('勉強する', pos, 'Present'), ['勉強する']);
    assert.deepEqual(forms('勉強する', pos, 'Negative'), ['勉強しない']);
    assert.deepEqual(forms('勉強する', pos, 'Present', 'polite'), ['勉強します']);
    assert.deepEqual(forms('勉強する', pos, 'Past'), ['勉強した']);
    assert.deepEqual(forms('勉強する', pos, 'Te-form'), ['勉強して']);
    assert.deepEqual(forms('勉強する', pos, 'Volitional'), ['勉強しよう']);
    assert.deepEqual(forms('勉強する', pos, 'Potential'), ['勉強できる']);
    assert.deepEqual(forms('勉強する', pos, 'Passive'), ['勉強される']);
    assert.deepEqual(forms('勉強する', pos, 'Causative'), ['勉強させる']);
    assert.deepEqual(forms('勉強する', pos, 'Conditional'), ['勉強すれば']);
    assert.match(conjugate('勉強する', pos)!.pattern, /ending in する/);
  });

  it('handles bare する', () => {
    assert.deepEqual(forms('する', pos, 'Negative'), ['しない']);
    assert.deepEqual(forms('する', pos, 'Past', 'polite'), ['しました']);
    assert.equal(conjugate('する', pos)!.className, 'irregular verb');
    assert.match(conjugate('する', pos)!.pattern, /two irregular verbs/);
  });

  it('special-class verbs take さ, せ and そ', () => {
    const p = 'Suru verb - special class';
    assert.deepEqual(forms('愛する', p, 'Negative'), ['愛さない']);
    assert.deepEqual(forms('愛する', p, 'Volitional'), ['愛そう']);
    assert.deepEqual(forms('愛する', p, 'Potential'), ['愛せる']);
    assert.deepEqual(forms('愛する', p, 'Present', 'polite'), ['愛します']);
    assert.match(conjugate('愛する', p)!.pattern, /愛さない/);
  });
});

describe('来る', () => {
  const pos = 'Kuru verb - special class';
  it('keeps the kanji and changes the okurigana', () => {
    assert.deepEqual(forms('来る', pos, 'Present'), ['来る']);
    assert.deepEqual(forms('来る', pos, 'Negative'), ['来ない']);
    assert.deepEqual(forms('来る', pos, 'Present', 'polite'), ['来ます']);
    assert.deepEqual(forms('来る', pos, 'Past'), ['来た']);
    assert.deepEqual(forms('来る', pos, 'Te-form'), ['来て']);
    assert.deepEqual(forms('来る', pos, 'Volitional'), ['来よう']);
    assert.deepEqual(forms('来る', pos, 'Potential'), ['来られる']);
    assert.deepEqual(forms('来る', pos, 'Conditional'), ['来れば']);
  });

  it('changes く to こ, き or く in kana', () => {
    assert.deepEqual(forms('くる', pos, 'Negative'), ['こない']);
    assert.deepEqual(forms('くる', pos, 'Present', 'polite'), ['きます']);
    assert.deepEqual(forms('くる', pos, 'Past'), ['きた']);
    assert.deepEqual(forms('くる', pos, 'Te-form'), ['きて']);
    assert.deepEqual(forms('くる', pos, 'Volitional'), ['こよう']);
    assert.deepEqual(forms('くる', pos, 'Conditional'), ['くれば']);
  });

  it('handles compounds such as 持って来る', () => {
    assert.deepEqual(forms('持って来る', pos, 'Negative'), ['持って来ない']);
  });
});

describe('い-adjectives', () => {
  const pos = 'I-adjective (keiyoushi)';
  it('conjugates from the stem', () => {
    assert.deepEqual(forms('高い', pos, 'Present'), ['高い']);
    assert.deepEqual(forms('高い', pos, 'Present', 'polite'), ['高いです']);
    assert.deepEqual(forms('高い', pos, 'Negative'), ['高くない']);
    assert.deepEqual(forms('高い', pos, 'Negative', 'polite'), ['高くないです', '高くありません']);
    assert.deepEqual(forms('高い', pos, 'Past'), ['高かった']);
    assert.deepEqual(forms('高い', pos, 'Past', 'polite'), ['高かったです']);
    assert.deepEqual(forms('高い', pos, 'Past negative'), ['高くなかった']);
    assert.deepEqual(forms('高い', pos, 'Past negative', 'polite'), ['高くなかったです', '高くありませんでした']);
    assert.deepEqual(forms('高い', pos, 'Te-form'), ['高くて']);
    assert.deepEqual(forms('高い', pos, 'Adverb'), ['高く']);
    assert.equal(conjugate('高い', pos)!.className, 'い-adjective');
  });

  it('conjugates いい and its compounds from よい', () => {
    assert.deepEqual(forms('いい', pos, 'Negative'), ['よくない']);
    assert.deepEqual(forms('いい', pos, 'Past'), ['よかった']);
    assert.deepEqual(forms('かっこいい', pos, 'Negative'), ['かっこよくない']);
    assert.deepEqual(forms('かっこいい', pos, 'Present'), ['かっこいい']);
    assert.match(conjugate('いい', pos)!.pattern, /よい/);
  });
});

describe('な-adjectives', () => {
  const pos = 'Na-adjective (keiyodoshi)';
  it('attaches the copula forms', () => {
    assert.deepEqual(forms('静か', pos, 'Present'), ['静かだ', '静かである']);
    assert.deepEqual(forms('静か', pos, 'Present', 'polite'), ['静かです']);
    assert.deepEqual(forms('静か', pos, 'Negative'), ['静かじゃない', '静かではない']);
    assert.deepEqual(forms('静か', pos, 'Past'), ['静かだった', '静かであった']);
    assert.deepEqual(forms('静か', pos, 'Past', 'polite'), ['静かでした']);
    assert.deepEqual(forms('静か', pos, 'Te-form'), ['静かで']);
    assert.deepEqual(forms('静か', pos, 'Before a noun'), ['静かな']);
    assert.deepEqual(forms('静か', pos, 'Adverb'), ['静かに']);
    assert.equal(conjugate('静か', pos)!.className, 'な-adjective');
  });
});

describe('findForms', () => {
  const ichidan = () => conjugate('食べる', 'Ichidan verb')!;
  const labels = (conj: Conjugation, sentences: string[]) =>
    findForms(conj, sentences).map(m => `${conj.forms[m.form].label}/${m.register}/${m.text}`).sort();

  it('finds nothing in unrelated text', () => {
    assert.deepEqual(findForms(ichidan(), ['今日は天気がいいです。']), []);
    assert.deepEqual(findForms(ichidan(), []), []);
  });

  it('finds a form and reports its spelling and register', () => {
    assert.deepEqual(labels(ichidan(), ['朝ご飯を食べます。']), ['Present/polite/食べます']);
    assert.deepEqual(labels(ichidan(), ['朝ご飯を食べた。']), ['Past/plain/食べた']);
  });

  it('prefers the longer form when one contains another', () => {
    // 食べて is inside 食べている, and 食べて is also a Te-form spelling.
    assert.deepEqual(labels(ichidan(), ['今ご飯を食べています。']), ['Progressive/polite/食べています']);
    assert.deepEqual(labels(ichidan(), ['彼は食べている。']), ['Progressive/plain/食べている']);
  });

  it('keeps a shorter form when it also appears on its own', () => {
    const found = labels(ichidan(), ['食べて、食べている。']);
    assert.deepEqual(found, ['Progressive/plain/食べている', 'Te-form/plain/食べて']);
  });

  it('prefers 高くなかった over 高く', () => {
    const adj = conjugate('高い', 'I-adjective (keiyoushi)')!;
    assert.deepEqual(labels(adj, ['それは高くなかった。']), ['Past negative/plain/高くなかった']);
  });

  it('returns every form sharing a spelling', () => {
    // 〜られる is both potential and passive for an ichidan verb.
    assert.deepEqual(labels(ichidan(), ['食べられる。']), ['Passive/plain/食べられる', 'Potential/plain/食べられる']);
  });

  it('collects forms across sentences, once per form and register', () => {
    const found = labels(ichidan(), ['食べた。', '昨日も食べた。', '食べません。']);
    assert.deepEqual(found, ['Negative/polite/食べません', 'Past/plain/食べた']);
  });

  it("ignores ある's bare ない negative", () => {
    const aru = conjugate('ある', "Godan verb with 'ru' ending (irregular verb)")!;
    assert.deepEqual(findForms(aru, ['時間がない。', '時間がなかった。']), []);
    assert.deepEqual(labels(aru, ['時間があります。']), ['Present/polite/あります']);
  });

  it('matches every occurrence in a sentence', () => {
    assert.deepEqual(labels(ichidan(), ['食べたり食べなかったり']), ['Past negative/plain/食べなかった', 'Past/plain/食べた']);
  });
});
