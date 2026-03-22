import type {
  AppConfig,
  FeedSource,
  WordRecord,
  CandidateToken,
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
import path from 'path';

export interface PipelineResult {
  wordsCollected: number;
  outputPaths: { json: string; markdown: string; html: string };
}

export async function runPipeline(
  config: AppConfig,
  feeds: FeedSource[],
  date: string
): Promise<PipelineResult> {
  const db = new WordDatabase(config.database.path);
  const tokenizer = await getTokenizer();

  console.log(`[pipeline] Target: ${config.max_words_per_run} words at level "${config.level}"`);

  const collectedWords: WordRecord[] = [];
  const usedSources: string[] = [];

  // Fetch all articles upfront and interleave across feeds for topic variety
  const shuffledFeeds = shuffle([...feeds]);
  const allArticles: { article: ArticleContent; feedName: string }[] = [];

  for (const feed of shuffledFeeds) {
    const articles = await fetchFeedArticles(feed);
    shuffle(articles);
    for (const article of articles) {
      allArticles.push({ article, feedName: feed.name });
    }
  }

  // Shuffle the combined list so words come from different feeds/topics
  shuffle(allArticles);

  // One word per article — advances to a fresh article for each word
  for (const { article, feedName } of allArticles) {
    if (collectedWords.length >= config.max_words_per_run) break;

    const newWords = await processArticle(article, config, db, tokenizer, 1);
    if (newWords.length > 0) {
      collectedWords.push(newWords[0]);
      usedSources.push(feedName);
    }
  }

  if (collectedWords.length === 0) {
    console.warn('[pipeline] No new words found. All candidates may already be in the database.');
    db.close();
    return {
      wordsCollected: 0,
      outputPaths: { json: '', markdown: '', html: '' },
    };
  }

  console.log(`[pipeline] Collected ${collectedWords.length} word(s). Generating audio...`);

  // Generate TTS audio files
  const ttsProvider = resolveProvider(config);
  if (ttsProvider !== 'browser') {
    const htmlDir = path.resolve(process.cwd(), config.output.html);
    for (let i = 0; i < collectedWords.length; i++) {
      const result = await generateAudio(collectedWords[i], i, config, htmlDir);
      if (result) {
        collectedWords[i].wordAudioFile = result.wordAudioFile;
        collectedWords[i].audioProvider = result.provider;
        for (let j = 0; j < result.exampleAudioFiles.length; j++) {
          if (collectedWords[i].examples[j]) {
            collectedWords[i].examples[j].audioFile = result.exampleAudioFiles[j];
          }
        }
      }
    }
  }

  // Translate example sentences
  const translationProvider = await resolveTranslationProvider(config);
  if (translationProvider !== 'disabled') {
    console.log(`[pipeline] Translating examples (${translationProvider})...`);
    for (const record of collectedWords) {
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

  console.log(`[pipeline] Writing outputs...`);

  // Write outputs
  const jsonPath = writeJsonOutput(collectedWords, date, config.output.json);
  const mdPath = writeMarkdownOutput(collectedWords, date, config.output.markdown);
  const htmlPath = writeHtmlOutput(collectedWords, date, config.output.html);
  writeIndexOutput(collectedWords, date, config.output.html);

  // Mark all collected words as seen
  for (const record of collectedWords) {
    db.markSeen(record);
  }

  db.logRun(date, collectedWords.length, [...new Set(usedSources)]);
  db.close();

  return {
    wordsCollected: collectedWords.length,
    outputPaths: { json: jsonPath, markdown: mdPath, html: htmlPath },
  };
}

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

    // Quick pre-check: already seen this base form?
    if (db.hasSeen(candidate.baseForm, candidate.reading)) {
      continue;
    }

    const dictResult = await lookupWord(candidate.baseForm, config.jisho_delay_ms);
    if (!dictResult) continue;

    // Level check
    if (!levelMatches(dictResult.jlptLevel, config.level)) continue;

    // Re-check with canonical word form from dictionary
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
