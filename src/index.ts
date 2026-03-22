#!/usr/bin/env node
/**
 * Kotoba no Sekai (言葉の世界) — Automated Japanese Vocabulary Pipeline
 *
 * Usage:
 *   kotoba                          # run with defaults (config.yaml + sources.yaml)
 *   kotoba --config path/to/config.yaml
 *   kotoba --sources path/to/sources.yaml
 *   kotoba --level intermediate
 *   kotoba --max 20
 *   kotoba --dry-run               # tokenize and show candidates, don't write output
 *   kotoba --word 食べる            # find and digest a specific Japanese word
 *   kotoba --source "NHK News"     # select one word from a named source
 *   kotoba --url https://...       # select one word from a specific article URL
 *   kotoba --rebuild-index         # rebuild index pages without running the pipeline
 *   kotoba --help
 */

import { loadConfig, loadSources, ensureOutputDirs, resolveRunSlug } from './config.js';
import { runPipeline, runWordPipeline, runSourcePipeline, runUrlPipeline } from './pipeline.js';
import { rebuildIndexOutput } from './output/index.js';
import { publishOutput } from './publish.js';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--dry-run') {
      args['dry-run'] = true;
    } else if (arg === '--rebuild-index') {
      args['rebuild-index'] = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
Kotoba no Sekai (言葉の世界) — Automated Japanese Vocabulary Pipeline

USAGE
  kotoba [options]

OPTIONS
  --config  <path>    Path to config.yaml          (default: config.yaml)
  --sources <path>    Path to sources.yaml         (default: sources.yaml)
  --level   <level>   Override difficulty level    (beginner|intermediate|advanced|all)
  --max     <n>       Override max words per run
  --dry-run           Print candidates without writing output or updating DB
  --word    <word>    Search all feeds for a specific Japanese word and digest it
  --source  <name>    Select one word from a named source in sources.yaml
  --url     <url>     Fetch a specific article URL and select one word from it
  --publish           Sync output/web/ to the configured S3 or R2 bucket, then exit
  --rebuild-index     Rebuild index.html / manual.html / words.html, then exit
  --help, -h          Show this help

OUTPUTS (written to paths configured in config.yaml)
  output/data/words-YYYY-MM-DD.json      Anki-compatible JSON
  output/web/digest-YYYY-MM-DD.md        Markdown reading digest
  output/web/digest-YYYY-MM-DD.html      Self-contained HTML page
  output/web/index.html                  Daily digest archive
  output/web/manual.html                 Custom run archive (--word / --source / --url)
  output/web/words.html                  Master word list, A-Z by English definition

EXAMPLES
  kotoba
  kotoba --level advanced --max 5
  kotoba --word 食べる
  kotoba --source "NHK News"
  kotoba --url https://www3.nhk.or.jp/news/html/...
  kotoba --sources feeds/science.yaml
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const configPath  = typeof args.config  === 'string' ? args.config  : 'config.yaml';
  const sourcesPath = typeof args.sources === 'string' ? args.sources : 'sources.yaml';

  let config = loadConfig(configPath);

  // Utility commands — run immediately without loading feeds or printing the pipeline header
  if (args['rebuild-index']) {
    rebuildIndexOutput(config.output.html);
    return;
  }

  if (args['publish']) {
    await publishOutput(config);
    return;
  }

  const feeds = loadSources(sourcesPath);

  // CLI overrides
  if (typeof args.level === 'string') {
    const validLevels = ['beginner', 'intermediate', 'advanced', 'all'] as const;
    if (!validLevels.includes(args.level as typeof validLevels[number])) {
      console.error(`Invalid level: "${args.level}". Must be one of: ${validLevels.join(', ')}`);
      process.exit(1);
    }
    config = { ...config, level: args.level as typeof config.level };
  }

  if (typeof args.max === 'string') {
    const n = parseInt(args.max, 10);
    if (isNaN(n) || n < 1) {
      console.error('--max must be a positive integer');
      process.exit(1);
    }
    config = { ...config, max_words_per_run: n };
  }

  const date = new Date().toISOString().split('T')[0];

  console.log('');
  console.log('  言葉の世界 — World of Words');
  console.log(`  ${date}  |  level: ${config.level}  |  feeds: ${feeds.length}`);
  console.log('');

  if (args['dry-run']) {
    console.log('[dry-run] Fetching articles and extracting candidates only...');
    await dryRun(config, feeds);
    return;
  }

  ensureOutputDirs(config);
  const slug = resolveRunSlug(date, config.output.html);

  try {
    let result: { wordsCollected: number; outputPaths: { json: string; markdown: string; html: string } };

    if (typeof args.word === 'string') {
      result = await runWordPipeline(args.word, config, feeds, slug);
    } else if (typeof args.source === 'string') {
      result = await runSourcePipeline(args.source, config, feeds, slug);
    } else if (typeof args.url === 'string') {
      result = await runUrlPipeline(args.url, config, slug);
    } else {
      result = await runPipeline(config, feeds, slug);
    }

    if (result.wordsCollected === 0) {
      console.log('\n  No new words this run. Try a different level or add more feeds.\n');
      process.exit(0);
    }

    console.log('');
    console.log(`  ✓ ${result.wordsCollected} word(s) collected`);
    console.log(`  JSON     → ${result.outputPaths.json}`);
    console.log(`  Markdown → ${result.outputPaths.markdown}`);
    console.log(`  HTML     → ${result.outputPaths.html}`);
    console.log('');
  } catch (err) {
    console.error('\n[error]', (err as Error).message);
    if (process.env.DEBUG) console.error((err as Error).stack);
    process.exit(1);
  }
}

async function dryRun(
  config: ReturnType<typeof loadConfig>,
  feeds: ReturnType<typeof loadSources>
): Promise<void> {
  const { fetchFeedArticles, shuffle } = await import('./rss.js');
  const { getTokenizer, extractCandidates } = await import('./tokenizer.js');

  const tokenizer = await getTokenizer();
  const shuffledFeeds = shuffle([...feeds]);

  for (const feed of shuffledFeeds.slice(0, 2)) {
    const articles = await fetchFeedArticles(feed);
    console.log(`\n[${feed.name}] ${articles.length} articles`);

    for (const article of articles.slice(0, 2)) {
      const candidates = extractCandidates(article.text, tokenizer, config.min_word_length);
      console.log(`  Article: ${article.title}`);
      console.log(`  Candidates (first 10): ${candidates.slice(0, 10).map(c => c.baseForm).join('、')}`);
    }
  }
}

main();
