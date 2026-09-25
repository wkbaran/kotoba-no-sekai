// Conjugation tables for adjectives and nouns (nouns inflect through the
// copula だ/です). Built from the word and its Jisho part of speech at render
// time, so no stored data is needed and older words get a table on rebuild.

export type ConjugationClass = 'i-adjective' | 'na-adjective' | 'noun';

export interface ConjugationForm {
  /** English name of the form, e.g. "Past negative". */
  label: string;
  /** Plain (casual) form, and the other spellings it can appear as in text. */
  plain: string[];
  /** Polite form, when it differs from just adding です. */
  polite?: string[];
  /** Shown in the table but never highlighted, because the same spelling is usually something else. */
  unmatched?: boolean;
}

export interface Conjugation {
  cls: ConjugationClass;
  forms: ConjugationForm[];
}

export function conjugationClass(pos: string): ConjugationClass | null {
  if (/^I-adjective/i.test(pos)) return 'i-adjective';
  if (/^Na-adjective/i.test(pos)) return 'na-adjective';
  // "Noun or verb acting prenominally" is a modifier, not a noun that takes だ.
  if (/prenominally/i.test(pos)) return null;
  if (/^(Noun|Adverbial noun|Temporal noun|Proper noun)\b/i.test(pos)) return 'noun';
  return null;
}

/** Forms for a word, or null when its part of speech doesn't conjugate this way. */
export function conjugate(word: string, pos: string): Conjugation | null {
  const cls = conjugationClass(pos);
  if (!cls) return null;

  if (cls === 'i-adjective') {
    if (!word.endsWith('い')) return null;
    // いい (and compounds like かっこいい) conjugate from よい: よくない, よかった.
    const stem = word.endsWith('いい') ? word.slice(0, -2) + 'よ' : word.slice(0, -1);
    return {
      cls,
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

  // Na-adjectives and nouns share the copula; they differ before a noun (な vs の)
  // and na-adjectives also make an adverb with に.
  const w = word;
  const forms: ConjugationForm[] = [
    { label: 'Present', plain: [`${w}だ`, `${w}である`], polite: [`${w}です`] },
    { label: 'Negative', plain: [`${w}じゃない`, `${w}ではない`], polite: [`${w}じゃありません`, `${w}ではありません`, `${w}じゃないです`, `${w}ではないです`] },
    { label: 'Past', plain: [`${w}だった`, `${w}であった`], polite: [`${w}でした`] },
    { label: 'Past negative', plain: [`${w}じゃなかった`, `${w}ではなかった`], polite: [`${w}じゃありませんでした`, `${w}ではありませんでした`, `${w}じゃなかったです`, `${w}ではなかったです`] },
    // A noun followed by で is far more often the particle (学校で, "at school").
    { label: 'Te-form', plain: [`${w}で`], unmatched: cls === 'noun' },
    { label: 'Before a noun', plain: [cls === 'na-adjective' ? `${w}な` : `${w}の`] },
  ];
  if (cls === 'na-adjective') forms.push({ label: 'Adverb', plain: [`${w}に`] });
  return { cls, forms };
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
 * one at the same spot (高く inside 高くなかった, 学生で inside 学生です), only
 * the longer counts.
 */
export function findForms(conj: Conjugation, sentences: string[]): FormMatch[] {
  const found = new Map<string, FormMatch>();
  for (const sentence of sentences) {
    const hits: Array<FormMatch & { start: number; end: number }> = [];
    conj.forms.forEach((f, form) => {
      if (f.unmatched) return;
      for (const register of ['plain', 'polite'] as const) {
        for (const text of f[register] ?? []) {
          for (let at = sentence.indexOf(text); at >= 0; at = sentence.indexOf(text, at + 1)) {
            hits.push({ form, register, text, start: at, end: at + text.length });
          }
        }
      }
    });
    for (const h of hits) {
      const covered = hits.some(o => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start);
      if (!covered) found.set(`${h.form}:${h.register}`, { form: h.form, register: h.register, text: h.text });
    }
  }
  return [...found.values()];
}
