import type { AppConfig, TranslationProvider } from './types.js';

// ── Provider resolution ───────────────────────────────────

type ResolvedTranslationProvider = 'ollama' | 'google' | 'disabled';

/** Auth header for Ollama behind a proxy or a hosted endpoint; optional. */
function ollamaAuthHeaders(): Record<string, string> {
  const key = process.env.OLLAMA_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** Check if Ollama is reachable at the configured URL. */
async function isOllamaReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      headers: ollamaAuthHeaders(),
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveTranslationProvider(
  config: AppConfig
): Promise<ResolvedTranslationProvider> {
  const p = config.translation.provider;

  if (p === 'disabled') return 'disabled';

  if (p === 'ollama') {
    if (await isOllamaReachable(config.translation.ollama.url)) return 'ollama';
    console.warn('[translation] provider=ollama but Ollama is not reachable — translation disabled');
    return 'disabled';
  }

  if (p === 'google') {
    if (!process.env.GOOGLE_API_KEY) {
      console.warn('[translation] provider=google but GOOGLE_API_KEY is not set — translation disabled');
      return 'disabled';
    }
    return 'google';
  }

  // auto: try Ollama first, then Google, then disabled
  if (await isOllamaReachable(config.translation.ollama.url)) {
    console.log(`[translation] Using Ollama (${config.translation.ollama.model})`);
    return 'ollama';
  }
  if (process.env.GOOGLE_API_KEY) {
    console.log('[translation] Ollama unreachable — using Google Translate');
    return 'google';
  }

  console.log('[translation] No translation provider available — skipping');
  return 'disabled';
}

// ── Main entry point ─────────────────────────────────────

/**
 * Translate a Japanese sentence to English.
 * Returns null if translation fails or provider is disabled.
 */
export async function translateSentence(
  sentence: string,
  provider: ResolvedTranslationProvider,
  config: AppConfig
): Promise<string | null> {
  if (provider === 'disabled') return null;
  if (provider === 'ollama') return translateOllama(sentence, config);
  if (provider === 'google') return translateGoogle(sentence);
  return null;
}

// ── Ollama ────────────────────────────────────────────────

// The Ollama server may be shared with other clients, so a request can wait behind
// another model's work or a model swap. A 30s timeout with no retry lost a translation
// on 2026-09-29 (Hindsight was using qwen on the same server); allow for both.
const OLLAMA_TIMEOUT_MS = 120_000;
const OLLAMA_MAX_ATTEMPTS = 3;
const OLLAMA_RETRY_DELAY_MS = 5_000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function translateOllama(sentence: string, config: AppConfig): Promise<string | null> {
  const { url, model } = config.translation.ollama;

  const prompt =
    'Translate the following Japanese sentence into natural English. ' +
    'Output only the translation with no explanation, no quotes, no punctuation changes beyond what is natural in English.\n\n' +
    sentence;

  for (let attempt = 1; attempt <= OLLAMA_MAX_ATTEMPTS; attempt++) {
    const retriable = attempt < OLLAMA_MAX_ATTEMPTS;
    let failure: string;
    let retry = true;

    try {
      const res = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ollamaAuthHeaders() },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      });

      if (res.ok) {
        const json = await res.json() as { response?: string; error?: string };
        if (!json.error) return json.response?.trim() ?? null;
        // e.g. model not found: retrying won't change the answer
        failure = `error: ${json.error}`;
        retry = false;
      } else {
        const body = await res.text();
        failure = `HTTP ${res.status}: ${body.slice(0, 200)}`;
        // Busy or overloaded servers are worth another try; other 4xx are not.
        retry = res.status >= 500 || res.status === 429;
      }
    } catch (err) {
      failure = `request failed: ${(err as Error).message}`;
    }

    if (!retry || !retriable) {
      console.warn(`[translation] Ollama ${failure}`);
      return null;
    }
    const delay = OLLAMA_RETRY_DELAY_MS * attempt;
    console.warn(
      `[translation] Ollama ${failure} (attempt ${attempt}/${OLLAMA_MAX_ATTEMPTS}), retrying in ${delay / 1000}s`
    );
    await sleep(delay);
  }

  return null;
}

// ── Translation markup ───────────────────────────────────

/**
 * Returns an HTML-escaped version of `translation` with the best-matching
 * keyword from `definition` / `altDefinitions` wrapped in <mark> tags.
 * Falls back to plain HTML-escaped text if no keyword is found.
 */
export function markTranslation(
  translation: string,
  definition: string,
  altDefinitions: string[]
): string {
  const escaped = escapeHtml(translation);

  // Build candidates: strip leading "to ", take the first word/phrase before
  // punctuation or parentheses, lowercase for matching.
  const candidates = [definition, ...altDefinitions.slice(0, 2)]
    .map(d => d.replace(/^to /, '').split(/[;,\/\(]/)[0].trim())
    .filter(d => d.length > 2);

  for (const keyword of candidates) {
    const escapedKeyword = escapeHtml(keyword);
    const pattern = escapedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${pattern})`, 'gi');
    const marked = escaped.replace(re, '<mark>$1</mark>');
    if (marked !== escaped) return marked;
  }

  return escaped;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Google Translate ──────────────────────────────────────

async function translateGoogle(sentence: string): Promise<string | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;

  let res: Response;
  try {
    res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: sentence, source: 'ja', target: 'en', format: 'text' }),
        signal: AbortSignal.timeout(10000),
      }
    );
  } catch (err) {
    console.warn(`[translation] Google request failed: ${(err as Error).message}`);
    return null;
  }

  if (!res.ok) {
    const body = await res.text();
    console.warn(`[translation] Google HTTP ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }

  const json = await res.json() as {
    data?: { translations?: { translatedText: string }[] };
  };

  return json.data?.translations?.[0]?.translatedText?.trim() ?? null;
}
