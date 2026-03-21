import kuromoji from 'kuromoji';
import path from 'path';
import type { CandidateToken } from './types.js';

// Parts of speech (品詞) to include as vocabulary candidates
const INCLUDE_POS = new Set([
  '名詞',   // nouns
  '動詞',   // verbs
  '形容詞', // i-adjectives
  '形容動詞', // na-adjectives (MeCab sometimes uses this)
]);

// Sub-classifications of 名詞 to skip (not useful vocabulary)
const EXCLUDE_NOUN_SUBTYPES = new Set([
  '数',         // numbers
  '接尾',       // suffixes
  '非自立',     // dependent nouns
  '代名詞',     // pronouns
  'サ変接続',   // suru-verb nouns that are more grammar than vocab (keep some)
]);

// Common words to skip regardless of POS
const SKIP_SURFACE = new Set([
  'する', 'ある', 'いる', 'なる', 'れる', 'られる', 'せる', 'させる',
  'ない', 'です', 'ます', 'でした', 'ました', 'ている', 'てある',
  'こと', 'もの', 'ため', 'よう', 'とき', 'ところ', 'わけ',
]);

type KuromojiTokenizer = {
  tokenize: (text: string) => kuromoji.IpadicFeatures[];
};

let tokenizerInstance: KuromojiTokenizer | null = null;

export async function getTokenizer(): Promise<KuromojiTokenizer> {
  if (tokenizerInstance) return tokenizerInstance;

  // kuromoji dict is always at node_modules/kuromoji/dict relative to project root
  const dicPath = path.resolve(process.cwd(), 'node_modules/kuromoji/dict');

  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, tokenizer) => {
      if (err) {
        reject(new Error(`Kuromoji failed to initialize: ${err.message}`));
        return;
      }
      tokenizerInstance = tokenizer;
      resolve(tokenizer);
    });
  });
}

/** Convert katakana to hiragana */
function toHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

/**
 * Tokenize Japanese text and return content-word candidates.
 * Deduped by baseForm so each dictionary entry appears only once per article.
 */
export function extractCandidates(
  text: string,
  tokenizer: KuromojiTokenizer,
  minLength: number
): CandidateToken[] {
  const tokens = tokenizer.tokenize(text);
  const seen = new Set<string>();
  const candidates: CandidateToken[] = [];

  for (const token of tokens) {
    const pos = token.pos;
    if (!INCLUDE_POS.has(pos)) continue;

    // Filter out unhelpful noun subtypes
    if (pos === '名詞' && EXCLUDE_NOUN_SUBTYPES.has(token.pos_detail_1)) continue;

    const surface = token.surface_form;
    const baseForm = token.basic_form && token.basic_form !== '*' ? token.basic_form : surface;
    const readingKatakana = token.reading && token.reading !== '*' ? token.reading : surface;
    const reading = toHiragana(readingKatakana);

    if (surface.length < minLength) continue;
    if (SKIP_SURFACE.has(baseForm)) continue;

    // Skip purely ASCII/numeric tokens
    if (/^[a-zA-Z0-9\s]+$/.test(surface)) continue;

    // Dedup by baseForm within this article
    if (seen.has(baseForm)) continue;
    seen.add(baseForm);

    candidates.push({
      surface,
      baseForm,
      reading,
      pos,
    });
  }

  return candidates;
}
