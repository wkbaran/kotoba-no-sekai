import type { JlptLevel, Level } from './types.js';

// ── Jisho API types ──────────────────────────────────────

interface JishoSense {
  english_definitions: string[];
  parts_of_speech: string[];
  tags: string[];
  info: string[];
}

interface JishoJapanese {
  word?: string;
  reading?: string;
}

interface JishoEntry {
  slug: string;
  is_common: boolean;
  jlpt: string[];
  japanese: JishoJapanese[];
  senses: JishoSense[];
}

interface JishoResponse {
  meta: { status: number };
  data: JishoEntry[];
}

export interface DictionaryResult {
  word: string;
  reading: string;
  pos: string;
  definition: string;
  altDefinitions: string[];
  jlptLevel: JlptLevel;
}

// ── JLPT level helpers ───────────────────────────────────

const JLPT_TAG_MAP: Record<string, JlptLevel> = {
  'jlpt-n5': 'N5',
  'jlpt-n4': 'N4',
  'jlpt-n3': 'N3',
  'jlpt-n2': 'N2',
  'jlpt-n1': 'N1',
};

const LEVEL_TO_JLPT: Record<Level, Set<JlptLevel>> = {
  beginner:     new Set(['N5', 'N4']),
  intermediate: new Set(['N3']),
  advanced:     new Set(['N2', 'N1']),
  all:          new Set(['N5', 'N4', 'N3', 'N2', 'N1', 'unknown']),
};

export function jlptTagToLevel(tags: string[]): JlptLevel {
  for (const tag of tags) {
    const level = JLPT_TAG_MAP[tag.toLowerCase()];
    if (level) return level;
  }
  return 'unknown';
}

export function levelMatches(jlptLevel: JlptLevel, configLevel: Level): boolean {
  return LEVEL_TO_JLPT[configLevel].has(jlptLevel);
}

// ── Jisho API lookup ─────────────────────────────────────

const JISHO_BASE = 'https://jisho.org/api/v1/search/words';

export async function lookupWord(
  word: string,
  delayMs: number
): Promise<DictionaryResult | null> {
  await sleep(delayMs);

  let data: JishoResponse;
  try {
    const res = await fetch(`${JISHO_BASE}?keyword=${encodeURIComponent(word)}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[dict] Jisho HTTP ${res.status} for "${word}"`);
      return null;
    }

    data = await res.json() as JishoResponse;
  } catch (err) {
    console.warn(`[dict] Jisho lookup failed for "${word}": ${(err as Error).message}`);
    return null;
  }

  if (!data.data || data.data.length === 0) return null;

  // Prefer an exact match over the first result
  const entry =
    data.data.find(e => e.japanese.some(j => j.word === word || j.reading === word)) ??
    data.data[0];

  const jp = entry.japanese[0] ?? {};
  const sense = entry.senses[0];
  if (!sense) return null;

  const allDefs = sense.english_definitions;
  const [definition = '', ...altDefinitions] = allDefs;

  const pos = sense.parts_of_speech[0] ?? 'Unknown';
  const jlptLevel = jlptTagToLevel(entry.jlpt);

  // Use the entry's canonical word/reading, falling back to what we searched for
  const resultWord = jp.word ?? word;
  const resultReading = jp.reading ?? word;

  return {
    word: resultWord,
    reading: resultReading,
    pos,
    definition,
    altDefinitions,
    jlptLevel,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
