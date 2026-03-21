import type { ExampleSentence } from './types.js';

// Japanese sentence-ending punctuation
const SENTENCE_END = /(?<=[。！？…])\s*/;

/** Split Japanese text into sentences. */
export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_END)
    .map(s => s.trim())
    .filter(s => s.length >= 10 && s.length <= 300);
}

/**
 * Find sentences in the article text that contain the target word,
 * wrap the word in <mark> tags, and return ExampleSentence objects.
 *
 * @param text      Full article text (plain)
 * @param surface   Surface form of the word (as it appears in the text)
 * @param word      Canonical word (kanji form from dictionary)
 * @param sourceUrl URL of the article
 * @param maxCount  Maximum number of sentences to return
 */
export function findExamples(
  text: string,
  surface: string,
  word: string,
  sourceUrl: string,
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

    // Escape for safe HTML insertion (sentence is plain text, not HTML)
    const escapedSentence = escapeHtml(sentence);
    const escapedTarget = escapeHtml(matchedTarget);

    const markedHtml = escapedSentence.replace(
      escapedTarget,
      `<mark>${escapedTarget}</mark>`
    );

    results.push({
      markedHtml,
      plain: sentence,
      sourceUrl: sourceUrl + '#:~:text=' + encodeURIComponent(matchedTarget),
    });
  }

  return results;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
