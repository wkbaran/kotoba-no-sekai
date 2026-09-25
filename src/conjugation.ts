// Conjugation tables for verbs and adjectives. Built from the word and its
// Jisho part of speech at render time, so no stored data is needed and older
// words get a table on rebuild.

export type ConjugationClass = 'i-adjective' | 'na-adjective' | 'godan' | 'ichidan' | 'suru' | 'kuru';

export interface ConjugationForm {
  /** English name of the form, e.g. "Past negative". */
  label: string;
  /** Plain (casual) form, and the other spellings it can appear as in text. */
  plain: string[];
  /** Polite form, and its other spellings. */
  polite?: string[];
}

export interface Conjugation {
  cls: ConjugationClass;
  /** Short name of the class for display, e.g. "godan verb". */
  className: string;
  /** One sentence on how the word's class conjugates, for when no form is found in the sentences. */
  pattern: string;
  forms: ConjugationForm[];
}

// Godan verbs conjugate by moving the final kana along its row: the a-, i-, e-
// and o-sounds, plus the sound change before て/た.
const GODAN_ROWS: Record<string, { a: string; i: string; e: string; o: string; te: string; ta: string }> = {
  'う': { a: 'わ', i: 'い', e: 'え', o: 'お', te: 'って', ta: 'った' },
  'く': { a: 'か', i: 'き', e: 'け', o: 'こ', te: 'いて', ta: 'いた' },
  'ぐ': { a: 'が', i: 'ぎ', e: 'げ', o: 'ご', te: 'いで', ta: 'いだ' },
  'す': { a: 'さ', i: 'し', e: 'せ', o: 'そ', te: 'して', ta: 'した' },
  'つ': { a: 'た', i: 'ち', e: 'て', o: 'と', te: 'って', ta: 'った' },
  'ぬ': { a: 'な', i: 'に', e: 'ね', o: 'の', te: 'んで', ta: 'んだ' },
  'ぶ': { a: 'ば', i: 'び', e: 'べ', o: 'ぼ', te: 'んで', ta: 'んだ' },
  'む': { a: 'ま', i: 'み', e: 'め', o: 'も', te: 'んで', ta: 'んだ' },
  'る': { a: 'ら', i: 'り', e: 'れ', o: 'ろ', te: 'って', ta: 'った' },
};

/** Stems a verb conjugates from; every verb class reduces to these. */
interface VerbStems {
  dict: string;
  /** Before ない (書か, 食べ). */
  neg: string;
  /** Before ます (書き, 食べ). */
  masu: string;
  te: string;
  ta: string;
  volitional: string;
  potential: string;
  passive: string;
  causative: string;
  conditional: string;
}

export function conjugationClass(pos: string): ConjugationClass | null {
  if (/^I-adjective/i.test(pos)) return 'i-adjective';
  if (/^Na-adjective/i.test(pos)) return 'na-adjective';
  if (/^Godan verb/i.test(pos)) return 'godan';
  // -zuru verbs (信ずる) mix two patterns; leave them without a table.
  if (/^Ichidan verb(?! - zuru)/i.test(pos)) return 'ichidan';
  if (/^Suru verb/i.test(pos)) return 'suru';
  if (/^Kuru verb/i.test(pos)) return 'kuru';
  return null;
}

/** Forms for a word, or null when its part of speech has no table. */
export function conjugate(word: string, pos: string): Conjugation | null {
  const cls = conjugationClass(pos);
  if (!cls) return null;
  if (cls === 'i-adjective') return iAdjective(word);
  if (cls === 'na-adjective') return naAdjective(word);
  const verb = verbStems(word, cls, pos);
  return verb && { cls, ...verb.describe, forms: verbForms(verb.stems) };
}

function iAdjective(word: string): Conjugation | null {
  if (!word.endsWith('い')) return null;
  // いい (and compounds like かっこいい) conjugate from よい: よくない, よかった.
  const stem = word.endsWith('いい') ? word.slice(0, -2) + 'よ' : word.slice(0, -1);
  return {
    cls: 'i-adjective',
    className: 'い-adjective',
    pattern: word.endsWith('いい')
      ? `${word} conjugates from よい: ${stem}くない, ${stem}かった.`
      : 'Every い-adjective follows this pattern.',
    forms: [
      { label: 'Present', plain: [word], polite: [`${word}です`] },
      { label: 'Negative', plain: [`${stem}くない`], polite: [`${stem}くないです`, `${stem}くありません`] },
      { label: 'Past', plain: [`${stem}かった`], polite: [`${stem}かったです`] },
      { label: 'Past negative', plain: [`${stem}くなかった`], polite: [`${stem}くなかったです`, `${stem}くありませんでした`] },
      { label: 'Te-form', plain: [`${stem}くて`] },
      { label: 'Adverb', plain: [`${stem}く`] },
    ],
  };
}

function naAdjective(w: string): Conjugation {
  return {
    cls: 'na-adjective',
    className: 'な-adjective',
    pattern: 'Every な-adjective follows this pattern.',
    forms: [
      { label: 'Present', plain: [`${w}だ`, `${w}である`], polite: [`${w}です`] },
      { label: 'Negative', plain: [`${w}じゃない`, `${w}ではない`], polite: [`${w}じゃありません`, `${w}ではありません`, `${w}じゃないです`, `${w}ではないです`] },
      { label: 'Past', plain: [`${w}だった`, `${w}であった`], polite: [`${w}でした`] },
      { label: 'Past negative', plain: [`${w}じゃなかった`, `${w}ではなかった`], polite: [`${w}じゃありませんでした`, `${w}ではありませんでした`, `${w}じゃなかったです`, `${w}ではなかったです`] },
      { label: 'Te-form', plain: [`${w}で`] },
      { label: 'Before a noun', plain: [`${w}な`] },
      { label: 'Adverb', plain: [`${w}に`] },
    ],
  };
}

function verbStems(
  word: string,
  cls: 'godan' | 'ichidan' | 'suru' | 'kuru',
  pos: string
): { stems: VerbStems; describe: Pick<Conjugation, 'className' | 'pattern'> } | null {
  if (cls === 'ichidan') {
    if (!word.endsWith('る')) return null;
    const s = word.slice(0, -1);
    return {
      stems: {
        dict: word, neg: s, masu: s, te: `${s}て`, ta: `${s}た`, volitional: `${s}よう`,
        potential: `${s}られる`, passive: `${s}られる`, causative: `${s}させる`, conditional: `${s}れば`,
      },
      describe: { className: 'ichidan verb', pattern: 'Every ichidan verb follows this pattern: drop る and add the ending.' },
    };
  }

  if (cls === 'suru') {
    if (!word.endsWith('する')) return null;
    const p = word.slice(0, -2);
    // Special-class する verbs (愛する) take the older さ in the negative: 愛さない.
    const special = /special class/i.test(pos);
    return {
      stems: {
        dict: word, neg: `${p}${special ? 'さ' : 'し'}`, masu: `${p}し`, te: `${p}して`, ta: `${p}した`,
        volitional: special ? `${p}そう` : `${p}しよう`,
        potential: special ? `${p}せる` : `${p}できる`, passive: `${p}される`, causative: `${p}させる`, conditional: `${p}すれば`,
      },
      describe: {
        className: 'irregular verb',
        pattern: special
          ? `${word} conjugates like する, but with さ, せ and そ in some forms: ${p}さない, ${p}せる.`
          : p ? 'Every verb ending in する conjugates like する.' : 'する is one of the two irregular verbs.',
      },
    };
  }

  if (cls === 'kuru') {
    // Written 来る, the kanji stays and only the okurigana changes; in kana, く becomes こ or き.
    const kanji = word.endsWith('来る');
    if (!kanji && !word.endsWith('くる')) return null;
    const p = word.slice(0, -2);
    const [ko, ki, ku] = kanji ? [`${p}来`, `${p}来`, `${p}来`] : [`${p}こ`, `${p}き`, `${p}く`];
    return {
      stems: {
        dict: word, neg: ko, masu: ki, te: `${ki}て`, ta: `${ki}た`, volitional: `${ko}よう`,
        potential: `${ko}られる`, passive: `${ko}られる`, causative: `${ko}させる`, conditional: `${ku}れば`,
      },
      describe: {
        className: 'irregular verb',
        pattern: kanji ? '来る is one of the two irregular verbs, read こ, き or く depending on the form.' : 'くる is one of the two irregular verbs.',
      },
    };
  }

  const last = word.slice(-1);
  const row = GODAN_ROWS[last];
  if (!row) return null;
  const s = word.slice(0, -1);
  const iku = /Iku\/Yuku special/i.test(pos);
  // 問う and 請う keep う before て/た: 問うて, 問うた.
  const uSpecial = /'u' ending \(special/i.test(pos);
  // ある (有る, 在る) has no あらない; its negative is plain ない.
  const aru = /\(irregular verb\)/i.test(pos);
  // いらっしゃる, くださる, おっしゃる, なさる take い before ます.
  const aruHonorific = /-aru special/i.test(pos);
  const te = iku ? `${s}って` : uSpecial ? `${word}て` : `${s}${row.te}`;
  const ta = iku ? `${s}った` : uSpecial ? `${word}た` : `${s}${row.ta}`;
  return {
    stems: {
      dict: word,
      neg: aru ? s.slice(0, -1) : `${s}${row.a}`,
      masu: aruHonorific ? `${s}い` : `${s}${row.i}`,
      te, ta,
      volitional: `${s}${row.o}う`,
      potential: `${s}${row.e}る`,
      passive: `${s}${row.a}れる`,
      causative: `${s}${row.a}せる`,
      conditional: `${s}${row.e}ば`,
    },
    describe: {
      className: 'godan verb',
      pattern: iku
        ? `${word} is a godan verb with one exception: ${te}, not ${s}いて.`
        : aru
          ? `${word} is a godan verb whose negative is simply ない.`
          : aruHonorific
            ? `${word} is a godan verb that takes い before ます: ${s}います.`
            : uSpecial
              ? `${word} is a godan verb that keeps う before て and た: ${te}, ${ta}.`
              : `Every godan verb ending in ${last} follows this pattern: ${word} → ${s}${row.a}ない, ${s}${row.i}ます, ${te}.`,
    },
  };
}

function verbForms(v: VerbStems): ConjugationForm[] {
  // Potential, passive and causative verbs are themselves ichidan: drop る before ます.
  const ru = (s: string) => s.slice(0, -1);
  return [
    { label: 'Present', plain: [v.dict], polite: [`${v.masu}ます`] },
    { label: 'Negative', plain: [`${v.neg}ない`], polite: [`${v.masu}ません`] },
    { label: 'Past', plain: [v.ta], polite: [`${v.masu}ました`] },
    { label: 'Past negative', plain: [`${v.neg}なかった`], polite: [`${v.masu}ませんでした`] },
    { label: 'Te-form', plain: [v.te] },
    // Written ている/ていた, often contracted to てる in quotes.
    { label: 'Progressive', plain: [`${v.te}いる`, `${v.te}いた`, `${v.te}る`], polite: [`${v.te}います`, `${v.te}いました`] },
    { label: 'Volitional', plain: [v.volitional], polite: [`${v.masu}ましょう`] },
    { label: 'Potential', plain: [v.potential], polite: [`${ru(v.potential)}ます`] },
    { label: 'Passive', plain: [v.passive], polite: [`${ru(v.passive)}ます`] },
    { label: 'Causative', plain: [v.causative], polite: [`${ru(v.causative)}ます`] },
    { label: 'Conditional', plain: [v.conditional] },
  ];
}

export interface FormMatch {
  /** Index into Conjugation.forms. */
  form: number;
  register: 'plain' | 'polite';
  /** The spelling that appeared in the text. */
  text: string;
}

/**
 * Which forms appear in the given sentences. Where one form is part of a longer
 * one at the same spot (食べて inside 食べている, 高く inside 高くなかった),
 * only the longer counts. Two forms can share a spelling (an ichidan verb's
 * potential and passive are both 〜られる); both are returned.
 */
export function findForms(conj: Conjugation, sentences: string[]): FormMatch[] {
  const found = new Map<string, FormMatch>();
  for (const sentence of sentences) {
    const hits: Array<FormMatch & { start: number; end: number }> = [];
    conj.forms.forEach((f, form) => {
      for (const register of ['plain', 'polite'] as const) {
        for (const text of f[register] ?? []) {
          // ある's negative is bare ない, which would match every ない in the sentence.
          if (text === 'ない' || text === 'なかった') continue;
          for (let at = sentence.indexOf(text); at >= 0; at = sentence.indexOf(text, at + 1)) {
            hits.push({ form, register, text, start: at, end: at + text.length });
          }
        }
      }
    });
    for (const h of hits) {
      const covered = hits.some(o => o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start);
      if (!covered) found.set(`${h.form}:${h.register}`, { form: h.form, register: h.register, text: h.text });
    }
  }
  return [...found.values()];
}
