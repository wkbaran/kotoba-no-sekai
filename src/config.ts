import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { AppConfig, FeedSource, SourcesConfig } from './types.js';

const DEFAULTS: AppConfig = {
  level: 'beginner',
  max_words_per_run: 4,
  max_examples_per_word: 2,
  min_word_length: 2,
  jisho_delay_ms: 600,
  output: {
    json: 'output/data',
    html: 'output/web',
    markdown: 'output/web',
  },
  database: {
    path: 'output/kotoba.db',
  },
};

function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export function loadConfig(configPath = 'config.yaml'): AppConfig {
  const fullPath = resolvePath(configPath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`[config] ${fullPath} not found — using defaults`);
    return DEFAULTS;
  }

  const raw = yaml.load(fs.readFileSync(fullPath, 'utf8')) as Partial<AppConfig>;

  const config: AppConfig = {
    ...DEFAULTS,
    ...raw,
    output: { ...DEFAULTS.output, ...(raw.output ?? {}) },
    database: { ...DEFAULTS.database, ...(raw.database ?? {}) },
  };

  const validLevels = ['beginner', 'intermediate', 'advanced', 'all'];
  if (!validLevels.includes(config.level)) {
    throw new Error(`Invalid level "${config.level}". Must be one of: ${validLevels.join(', ')}`);
  }

  return config;
}

export function loadSources(sourcesPath = 'sources.yaml'): FeedSource[] {
  const fullPath = resolvePath(sourcesPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`sources.yaml not found at ${fullPath}. Please create it to define your RSS feeds.`);
  }

  const raw = yaml.load(fs.readFileSync(fullPath, 'utf8')) as SourcesConfig;

  if (!raw.feeds || !Array.isArray(raw.feeds)) {
    throw new Error('sources.yaml must contain a "feeds" array.');
  }

  const feeds = raw.feeds.filter(f => f.enabled !== false);

  if (feeds.length === 0) {
    throw new Error('No enabled feeds found in sources.yaml.');
  }

  return feeds;
}

export function ensureOutputDirs(config: AppConfig): void {
  for (const dir of [config.output.json, config.output.html, config.output.markdown]) {
    const resolved = resolvePath(dir);
    fs.mkdirSync(resolved, { recursive: true });
  }

  // Ensure DB parent dir exists
  const dbDir = path.dirname(resolvePath(config.database.path));
  fs.mkdirSync(dbDir, { recursive: true });
}

export function resolveOutputPath(dir: string, filename: string): string {
  return path.join(resolvePath(dir), filename);
}
