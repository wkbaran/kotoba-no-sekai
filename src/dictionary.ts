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

// Jisho rejects Node's default fetch User-Agent with 403 "Request forbidden by
// administrative rules", so identify the pipeline explicitly.
const JISHO_USER_AGENT = 'KotobaNoSekai/1.0 (+https://github.com/wkbaran/kotoba-no-sekai)';

// Jisho rate-limits at more than 10 requests per 10 seconds (HTTP 429). Space
// request starts at least this far apart, however low jisho_delay_ms is set.
const JISHO_MIN_INTERVAL_MS = 1250;

// A 429 is retried after Retry-After (or this backoff, doubled per attempt,
// capped at the max wait); every other caller is held back for the same wait.
const JISHO_RATE_LIMIT_RETRIES = 3;
const JISHO_RATE_LIMIT_BACKOFF_MS = 10_000;
const JISHO_MAX_RETRY_WAIT_MS = 60_000;

// Abort the run rather than keep querying a Jisho that is down or blocking us.
const JISHO_MAX_CONSECUTIVE_FAILURES = 5;
const JISHO_MAX_TOTAL_FAILURES = 20;

export class JishoUnavailableError extends Error {}

let nextRequestAt = 0;
/** End of the most recent 429 wait; a request may not start before it. */
let rateLimitedUntil = 0;
let consecutiveFailures = 0;
let totalFailures = 0;
let unavailable: JishoUnavailableError | null = null;

/** Wait for the next request slot, reserving it first so concurrent callers never share one. */
async function throttle(delayMs: number): Promise<void> {
  for (;;) {
    const now = Date.now();
    const startAt = Math.max(now, nextRequestAt);
    nextRequestAt = startAt + Math.max(delayMs, JISHO_MIN_INTERVAL_MS);
    await sleep(startAt - now);
    // A 429 that arrived while we slept may have moved the hold past our slot. Reserve again,
    // behind it, so a caller that queued before the 429 does not send into the rate limit.
    if (rateLimitedUntil <= startAt) return;
  }
}

/** Log a failed lookup; throws JishoUnavailableError once the failure limits are reached. */
function recordFailure(reason: string): void {
  consecutiveFailures++;
  totalFailures++;
  console.warn(`[dict] ${reason}`);
  if (consecutiveFailures >= JISHO_MAX_CONSECUTIVE_FAILURES || totalFailures >= JISHO_MAX_TOTAL_FAILURES) {
    unavailable = new JishoUnavailableError(
      `Jisho lookups are failing (${consecutiveFailures} in a row, ${totalFailures} this run; last: ${reason}). Aborting run.`
    );
    throw unavailable;
  }
}

function retryWaitMs(res: Response, attempt: number): number {
  const retryAfterSec = Number(res.headers.get('retry-after'));
  const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : JISHO_RATE_LIMIT_BACKOFF_MS * 2 ** attempt;
  return Math.min(waitMs, JISHO_MAX_RETRY_WAIT_MS);
}

/**
 * Look up a word on Jisho. Returns null when there is no usable entry or the
 * request failed; throws JishoUnavailableError once too many requests have
 * failed this run, and on every call after that.
 */
export async function lookupWord(
  word: string,
  delayMs: number
): Promise<DictionaryResult | null> {
  if (unavailable) throw unavailable;

  let data: JishoResponse;
  for (let attempt = 0; ; attempt++) {
    await throttle(delayMs);

    let res: Response;
    try {
      res = await fetch(`${JISHO_BASE}?keyword=${encodeURIComponent(word)}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': JISHO_USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      recordFailure(`Jisho lookup failed for "${word}": ${(err as Error).message}`);
      return null;
    }

    if (res.status === 429 && attempt < JISHO_RATE_LIMIT_RETRIES) {
      const waitMs = retryWaitMs(res, attempt);
      console.warn(`[dict] Jisho rate limit hit (429) for "${word}"; backing off ${Math.round(waitMs / 1000)}s`);
      rateLimitedUntil = Date.now() + waitMs;
      nextRequestAt = Math.max(nextRequestAt, rateLimitedUntil);
      continue;
    }

    if (!res.ok) {
      recordFailure(`Jisho HTTP ${res.status} for "${word}"`);
      return null;
    }

    try {
      data = await res.json() as JishoResponse;
    } catch (err) {
      recordFailure(`Jisho returned unreadable JSON for "${word}": ${(err as Error).message}`);
      return null;
    }
    break;
  }

  consecutiveFailures = 0;

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

/**
 * Returns a lookup function that serializes calls to lookupWord, one at a time,
 * regardless of how many callers invoke it concurrently. Lets article scraping
 * run concurrently while keeping Jisho traffic to one in-flight request, spaced
 * by lookupWord's throttle, as in the original single-threaded pipeline.
 */
export function createSerialLookup(
  delayMs: number
): (word: string) => Promise<DictionaryResult | null> {
  let chain: Promise<unknown> = Promise.resolve();
  return (word: string): Promise<DictionaryResult | null> => {
    const result = chain.then(() => lookupWord(word, delayMs));
    chain = result;
    return result;
  };
}
