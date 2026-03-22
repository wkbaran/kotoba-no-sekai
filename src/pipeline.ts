import type {
  AppConfig,
  FeedSource,
  WordRecord,
  ArticleContent,
} from './types.js';
import { WordDatabase } from './db.js';
import { fetchFeedArticles, shuffle } from './rss.js';
import { getTokenizer, extractCandidates } from './tokenizer.js';
import { lookupWord, levelMatches } from './dictionary.js';
import { findExamples } from './sentences.js';
import { writeJsonOutput } from './output/json.js';
import { writeMarkdownOutput } from './output/markdown.js';
import { writeHtmlOutput } from './output/html.js';
import { writeIndexOutput } from './output/index.js';
import { generateAudio, resolveProvider } from './tts.js';
import { resolveTranslationProvider, translateSentence, markTranslation } from './translation.js';
import { scrapeArticleText } from './scraper.js';
import path from 'path';

export interface PipelineResult {
  wordsCollected: number;
  outputPaths: { json: string; markdown: string; html: string };
}

// ── Shared helpers ────────────────────────────────────────

/** Generate TTS audio and translations for all collected records (mutates in place). */
async function enrichRecords(
  records: WordRecord[],
  config: AppConfig,
  htmlDir: string
): Promise<void> {
  const ttsProvider = resolveProvider(config);
  if (ttsProvider !== 'browser') {
    for (let i = 0; i < records.length; i++) {
      const result = await generateAudio(records[i], i, config, htmlDir);
      if (result) {
        records[i].wordAudioFile = result.wordAudioFile;
        records[i].audioProvider = result.provider;
        for (let j = 0; j < result.exampleAudioFiles.length; j++) {
          if (records[i].examples[j]) {
            records[i].examples[j].audioFile = result.exampleAudioFiles[j];
          }
        }
      }
    }
  }

  const translationProvider = await resolveTranslationProvider(config);
  if (translationProvider !== 'disabled') {
    console.log(`[pipeline] Translating examples (${translationProvider})...`);
    for (const record of records) {
      for (const example of record.examples) {
        const translation = await translateSentence(example.plain, translationProvider, config);
        if (translation) {
          example.translation = translation;
          example.translationMarkedHtml = markTranslation(
            translation,
            record.definition,
            record.altDefinitions
          );
        }
      }
    }
  }
}

/** Write all output files (JSON, Markdown, HTML digest, index). Returns output paths. */
function writeRunOutputs(
  records: WordRecord[],
  date: string,
  config: AppConfig,
  mode: 'auto' | 'manual'
): { json: string; markdown: string; html: string } {
  const jsonPath = writeJsonOutput(records, date, config.output.json);
  const mdPath   = writeMarkdownOutput(records, date, config.output.markdown);
  const htmlPath = writeHtmlOutput(records, date, config.output.html);
  writeIndexOutput(records, date, config.output.html, mode);
  return { json: jsonPath, markdown: mdPath, html: htmlPath };
}

/** Fetch all articles from the given feeds, shuffled, as a flat list. */
async function fetchAllArticles(
  feeds: FeedSource[]
): Promise<{ article: ArticleContent; feedName: string }[]> {
  const all: { article: ArticleContent; feedName: string }[] = [];
  for (const feed of shuffle([...feeds])) {
    const articles = await fetchFeedArticles(feed);
    shuffle(articles);
    for (const article of articles) {
      all.push({ article, feedName: feed.name });
    }
  }
  shuffle(all);
  return all;
}

// ── Article processor ─────────────────────────────────────

async function processArticle(
  article: ArticleContent,
  config: AppConfig,
  db: WordDatabase,
  tokenizer: Awaited<ReturnType<typeof getTokenizer>>,
  maxWords = config.max_words_per_run
): Promise<WordRecord[]> {
  const candidates = extractCandidates(article.text, tokenizer, config.min_word_length);
  const results: WordRecord[] = [];

  for (const candidate of candidates) {
    if (results.length >= maxWords) break;

    if (db.hasSeen(candidate.baseForm, candidate.reading)) continue;

    const dictResult = await lookupWord(candidate.baseForm, config.jisho_delay_ms);
    if (!dictResult) continue;

    if (!levelMatches(dictResult.jlptLevel, config.level)) continue;

    if (db.hasSeen(dictResult.word, dictResult.reading)) continue;

    const examples = findExamples(
      article.text,
      candidate.surface,
      dictResult.word,
      article.url,
      config.max_examples_per_word
    );
    if (examples.length === 0) continue;

    const record: WordRecord = {
      word: dictResult.word,
      reading: dictResult.reading,
      pos: dictResult.pos,
      definition: dictResult.definition,
      altDefinitions: dictResult.altDefinitions,
      examples,
      sourceUrl: article.url,
      domain: article.domain,
      jlptLevel: dictResult.jlptLevel,
      date: new Date().toISOString().split('T')[0],
    };

    console.log(`[pipeline] ✓ ${record.word}【${record.reading}】 ${record.jlptLevel} (${record.pos})`);
    results.push(record);
  }

  return results;
}

// ── Standard automated pipeline ──────────────────────────

export async function runPipeline(
  config: AppConfig,
  feeds: FeedSource[],
  date: string
): Promise<PipelineResult> {
  const db = new WordDatabase(config.database.path);
  const tokenizer = await getTokenizer();

  console.log(`[pipeline] Target: ${config.max_words_per_run} words at level "${config.level}"`);

  const collectedPairs: { article: ArticleContent; record: WordRecord }[] = [];
  const usedSources: string[] = [];

  const allArticles = await fetchAllArticles(feeds);

  for (const { article, feedName } of allArticles) {
    if (collectedPairs.length >= config.max_words_per_run) break;

    const newWords = await processArticle(article, config, db, tokenizer, 1);
    if (newWords.length > 0) {
      collectedPairs.push({ article, record: newWords[0] });
      usedSources.push(feedName);
    }
  }

  if (collectedPairs.length === 0) {
    console.warn('[pipeline] No new words found. All candidates may already be in the database.');
    db.close();
    return { wordsCollected: 0, outputPaths: { json: '', markdown: '', html: '' } };
  }

  // Augment examples by searching all collected articles for each word
  console.log('[pipeline] Searching collected articles for additional examples...');
  for (const { record } of collectedPairs) {
    if (record.examples.length >= config.max_examples_per_word) {
      console.log(`[pipeline]   ${record.word}: already has ${record.examples.length} example(s), skipping`);
      continue;
    }
    const seen = new Set(record.examples.map(e => e.plain));
    const before = record.examples.length;
    for (const { article } of collectedPairs) {
      if (record.examples.length >= config.max_examples_per_word) break;
      if (article.url === record.sourceUrl) continue;
      const additional = findExamples(
        article.text,
        record.word,
        record.word,
        article.url,
        config.max_examples_per_word - record.examples.length
      );
      for (const ex of additional) {
        if (!seen.has(ex.plain)) {
          seen.add(ex.plain);
          record.examples.push(ex);
          if (record.examples.length >= config.max_examples_per_word) break;
        }
      }
    }
    const added = record.examples.length - before;
    console.log(`[pipeline]   ${record.word}: ${before} → ${record.examples.length} example(s)${added === 0 ? ' (no new matches)' : ''}`);
  }

  const collectedWords = collectedPairs.map(p => p.record);

  console.log(`[pipeline] Collected ${collectedWords.length} word(s). Generating audio...`);

  const htmlDir = path.resolve(process.cwd(), config.output.html);
  await enrichRecords(collectedWords, config, htmlDir);

  console.log('[pipeline] Writing outputs...');
  const outputPaths = writeRunOutputs(collectedWords, date, config, 'auto');

  for (const record of collectedWords) db.markSeen(record);
  db.logRun(date, collectedWords.length, [...new Set(usedSources)]);
  db.close();

  return { wordsCollected: collectedWords.length, outputPaths };
}

// ── Mode 1: search all feeds for a specific word ──────────

/**
 * Search all feed articles (each at most once) for any surface form of the given
 * Japanese word (matched by tokenizer base form). Produces a 1-word manual digest.
 */
export async function runWordPipeline(
  targetWord: string,
  config: AppConfig,
  feeds: FeedSource[],
  date: string
): Promise<PipelineResult> {
  const db = new WordDatabase(config.database.path);
  const tokenizer = await getTokenizer();

  console.log(`[pipeline] Searching for "${targetWord}" across all feeds...`);

  const allArticles = await fetchAllArticles(feeds);

  let record: WordRecord | null = null;

  for (const { article } of allArticles) {
    const candidates = extractCandidates(article.text, tokenizer, config.min_word_length);
    const match = candidates.find(c => c.baseForm === targetWord || c.surface === targetWord);
    if (!match) continue;

    const dictResult = await lookupWord(match.baseForm, config.jisho_delay_ms);
    if (!dictResult) continue;

    const examples = findExamples(
      article.text,
      match.surface,
      dictResult.word,
      article.url,
      config.max_examples_per_word
    );
    if (examples.length === 0) continue;

    record = {
      word: dictResult.word,
      reading: dictResult.reading,
      pos: dictResult.pos,
      definition: dictResult.definition,
      altDefinitions: dictResult.altDefinitions,
      examples,
      sourceUrl: article.url,
      domain: article.domain,
      jlptLevel: dictResult.jlptLevel,
      date: new Date().toISOString().split('T')[0],
    };

    console.log(`[pipeline] ✓ ${record.word}【${record.reading}】 ${record.jlptLevel} (${record.pos})`);
    break;
  }

  if (!record) {
    console.log(`\n  "${targetWord}" not found in any article.\n`);
    db.close();
    return { wordsCollected: 0, outputPaths: { json: '', markdown: '', html: '' } };
  }

  const htmlDir = path.resolve(process.cwd(), config.output.html);
  await enrichRecords([record], config, htmlDir);

  const outputPaths = writeRunOutputs([record], date, config, 'manual');

  db.markSeen(record);
  db.logRun(date, 1, [record.domain]);
  db.close();

  return { wordsCollected: 1, outputPaths };
}

// ── Mode 2: restrict to a named source ───────────────────

/**
 * Select one word from a specific named source in sources.yaml.
 * Produces a 1-word manual digest.
 */
export async function runSourcePipeline(
  sourceName: string,
  config: AppConfig,
  feeds: FeedSource[],
  date: string
): Promise<PipelineResult> {
  const source = feeds.find(f => f.name === sourceName);
  if (!source) {
    throw new Error(`Source "${sourceName}" not found in sources.yaml. Available: ${feeds.map(f => f.name).join(', ')}`);
  }

  const db = new WordDatabase(config.database.path);
  const tokenizer = await getTokenizer();

  console.log(`[pipeline] Selecting word from source "${sourceName}"...`);

  const articles = await fetchFeedArticles(source);
  shuffle(articles);

  let record: WordRecord | null = null;

  for (const article of articles) {
    const words = await processArticle(article, config, db, tokenizer, 1);
    if (words.length > 0) {
      record = words[0];
      break;
    }
  }

  if (!record) {
    console.log(`\n  No suitable word found in source "${sourceName}".\n`);
    db.close();
    return { wordsCollected: 0, outputPaths: { json: '', markdown: '', html: '' } };
  }

  const htmlDir = path.resolve(process.cwd(), config.output.html);
  await enrichRecords([record], config, htmlDir);

  const outputPaths = writeRunOutputs([record], date, config, 'manual');

  db.markSeen(record);
  db.logRun(date, 1, [source.name]);
  db.close();

  return { wordsCollected: 1, outputPaths };
}

// ── Mode 3: single article by URL ────────────────────────

/**
 * Fetch a specific article URL (not necessarily in sources.yaml) and select one word from it.
 * Produces a 1-word manual digest.
 */
export async function runUrlPipeline(
  url: string,
  config: AppConfig,
  date: string
): Promise<PipelineResult> {
  const db = new WordDatabase(config.database.path);
  const tokenizer = await getTokenizer();

  console.log(`[pipeline] Fetching article: ${url}`);

  const text = await scrapeArticleText(url);
  if (!text || text.trim().length < 50) {
    db.close();
    throw new Error(`Could not extract usable text from ${url}`);
  }

  let domain = url;
  try { domain = new URL(url).hostname; } catch { /* keep full url as fallback */ }

  const article: ArticleContent = { url, title: '', domain, text };
  const words = await processArticle(article, config, db, tokenizer, 1);

  if (words.length === 0) {
    console.log('\n  No suitable word found in this article.\n');
    db.close();
    return { wordsCollected: 0, outputPaths: { json: '', markdown: '', html: '' } };
  }

  const [record] = words;

  const htmlDir = path.resolve(process.cwd(), config.output.html);
  await enrichRecords([record], config, htmlDir);

  const outputPaths = writeRunOutputs([record], date, config, 'manual');

  db.markSeen(record);
  db.logRun(date, 1, [domain]);
  db.close();

  return { wordsCollected: 1, outputPaths };
}
