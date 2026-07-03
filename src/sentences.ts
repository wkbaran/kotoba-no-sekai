import type { ExampleSentence } from './types.js';
import { toHiragana, type KuromojiTokenizer } from './tokenizer.js';

// Japanese sentence-ending punctuation
const SENTENCE_END = /(?<=[。！？…])\s*/;

// Max character length for an example clause
const MAX_CLAUSE_LEN = 120;

/** Split Japanese text into sentences, respecting block boundaries. */
export function splitSentences(text: string): string[] {
  // First split on paragraph/block boundaries (\n\n) so sentences never
  // cross block-level HTML element boundaries (e.g. separate <p> tags).
  // Then split each block on Japanese sentence-ending punctuation.
  return text
    .split(/\n\n+/)
    .flatMap(para => para.split(SENTENCE_END))
    .map(s => s.trim())
    .filter(s => s.length >= 10 && s.length <= 300);
}

/**
 * For a long sentence, split on 、 and return the sub-sequence of clauses
 * that contains the target word, expanding outward (before and after) to
 * keep roughly equal context on each side while staying within MAX_CLAUSE_LEN.
 */
function extractClause(sentence: string, target: string): string {
  const clauses = sentence.split('、');
  if (clauses.length <= 1) return sentence;

  const idx = clauses.findIndex(c => c.includes(target));
  if (idx === -1) return sentence;

  let lo = idx, hi = idx;
  let beforeChars = 0, afterChars = 0;

  while (true) {
    const currentLen = clauses.slice(lo, hi + 1).join('、').length;
    const canAddBefore = lo > 0;
    const canAddAfter = hi < clauses.length - 1;
    if (!canAddBefore && !canAddAfter) break;

    const nextBeforeLen = canAddBefore ? clauses[lo - 1].length + 1 : Infinity;
    const nextAfterLen  = canAddAfter  ? clauses[hi + 1].length + 1 : Infinity;

    // Stop if even the smaller addition would exceed the limit
    if (currentLen + Math.min(nextBeforeLen, nextAfterLen) > MAX_CLAUSE_LEN) break;

    // Prefer the side with less accumulated context to stay balanced
    if (canAddBefore && (!canAddAfter || beforeChars <= afterChars)) {
      if (currentLen + nextBeforeLen <= MAX_CLAUSE_LEN) {
        beforeChars += nextBeforeLen; lo--;
      } else if (canAddAfter && currentLen + nextAfterLen <= MAX_CLAUSE_LEN) {
        afterChars += nextAfterLen; hi++;
      } else break;
    } else {
      if (canAddAfter && currentLen + nextAfterLen <= MAX_CLAUSE_LEN) {
        afterChars += nextAfterLen; hi++;
      } else if (canAddBefore && currentLen + nextBeforeLen <= MAX_CLAUSE_LEN) {
        beforeChars += nextBeforeLen; lo--;
      } else break;
    }
  }

  return clauses.slice(lo, hi + 1).join('、');
}

/**
 * Find sentences in the article text that contain the target word,
 * wrap the word in <mark> tags, and return ExampleSentence objects.
 *
 * @param text        Full article text (plain)
 * @param surface     Surface form of the word (as it appears in the text)
 * @param word        Canonical word (kanji form from dictionary)
 * @param sourceUrl   URL of the article
 * @param tokenizer   Kuromoji tokenizer, used to build the furigana-glossed HTML
 * @param articleText Archived backup copy of the article's prose (may be empty)
 * @param maxCount    Maximum number of sentences to return
 */
export function findExamples(
  text: string,
  surface: string,
  word: string,
  sourceUrl: string,
  tokenizer: KuromojiTokenizer,
  articleText: string,
  maxCount = 2
): ExampleSentence[] {
  const sentences = splitSentences(text);

  // Look for the surface form AND the canonical word form
  const targets = [...new Set([surface, word])].filter(Boolean);

  const results: ExampleSentence[] = [];

  for (const sentence of sentences) {
    if (results.length >= maxCount) break;

    const matchedTarget = targets.find(t => sentence.includes(t));
    if (!matchedTarget) continue;

    // Extract a shorter clause centered on the target word if sentence is long
    const clause = sentence.length > MAX_CLAUSE_LEN
      ? extractClause(sentence, matchedTarget)
      : sentence;

    // Escape for safe HTML insertion (clause is plain text, not HTML)
    const escapedClause = escapeHtml(clause);
    const escapedTarget = escapeHtml(matchedTarget);

    const markedHtml = escapedClause.replace(
      escapedTarget,
      `<mark>${escapedTarget}</mark>`
    );

    results.push({
      markedHtml,
      glossedHtml: annotateFurigana(clause, matchedTarget, tokenizer),
      plain: clause,
      sourceUrl: sourceUrl + '#:~:text=' + encodeURIComponent(matchedTarget),
      articleText,
    });
  }

  return results;
}

const KANJI_RE = /[一-龯]/;

function translateUrl(text: string): string {
  return `https://translate.google.com/?sl=ja&tl=en&text=${encodeURIComponent(text)}&op=translate`;
}

/**
 * Render a clause as HTML: every kanji word gets a furigana <ruby> reading,
 * and (except the target word/phrase, which is wrapped in <mark> instead)
 * links out to a Google Translate lookup for that word in a new tab.
 *
 * Relies on kuromoji tokenizing the clause into surface forms that, concatenated
 * in order, reconstruct the clause exactly — this lets us track each token's
 * character offsets and detect which one(s) overlap the target phrase.
 */
function annotateFurigana(clause: string, target: string, tokenizer: KuromojiTokenizer): string {
  const tokens = tokenizer.tokenize(clause);
  const targetStart = clause.indexOf(target);
  const targetEnd = targetStart >= 0 ? targetStart + target.length : -1;

  let offset = 0;
  let html = '';
  let targetBuffer = '';
  let inTarget = false;

  const flushTarget = () => {
    if (targetBuffer) html += `<mark>${targetBuffer}</mark>`;
    targetBuffer = '';
    inTarget = false;
  };

  for (const token of tokens) {
    const surface = token.surface_form;
    const start = offset;
    const end = offset + surface.length;
    offset = end;

    const overlapsTarget = targetStart >= 0 && start < targetEnd && end > targetStart;
    const hasKanji = KANJI_RE.test(surface);
    const escaped = escapeHtml(surface);

    const rendered = hasKanji
      ? `<ruby>${escaped}<rt>${escapeHtml(toHiragana(
          token.reading && token.reading !== '*' ? token.reading : surface
        ))}</rt></ruby>`
      : escaped;

    if (overlapsTarget) {
      targetBuffer += rendered;
      inTarget = true;
      continue;
    }

    if (inTarget) flushTarget();

    html += hasKanji
      ? `<a href="${translateUrl(surface)}" target="_blank" rel="noopener" class="gloss-link">${rendered}</a>`
      : rendered;
  }
  flushTarget();

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
