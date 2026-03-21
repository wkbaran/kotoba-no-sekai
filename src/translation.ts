import type { AppConfig, TranslationProvider } from './types.js';

// ── Provider resolution ───────────────────────────────────

type ResolvedTranslationProvider = 'ollama' | 'google' | 'disabled';

/** Check if Ollama is reachable at the configured URL. */
async function isOllamaReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, {
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

async function translateOllama(sentence: string, config: AppConfig): Promise<string | null> {
  const { url, model } = config.translation.ollama;

  const prompt =
    'Translate the following Japanese sentence into natural English. ' +
    'Output only the translation with no explanation, no quotes, no punctuation changes beyond what is natural in English.\n\n' +
    sentence;

  let res: Response;
  try {
    res = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    console.warn(`[translation] Ollama request failed: ${(err as Error).message}`);
    return null;
  }

  if (!res.ok) {
    const body = await res.text();
    console.warn(`[translation] Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }

  const json = await res.json() as { response?: string; error?: string };

  if (json.error) {
    console.warn(`[translation] Ollama error: ${json.error}`);
    return null;
  }

  return json.response?.trim() ?? null;
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
