import fs from 'fs';
import path from 'path';
import type { AppConfig, TtsProvider, WordRecord } from './types.js';

// ── Provider resolution ───────────────────────────────────

type ResolvedProvider = 'openai' | 'elevenlabs' | 'browser';

export function resolveProvider(config: AppConfig): ResolvedProvider {
  const p = config.tts.provider;

  if (p === 'disabled') return 'browser'; // caller checks for audio files; none will be written
  if (p === 'browser') return 'browser';

  if (p === 'elevenlabs') {
    if (!process.env.ELEVENLABS_API_KEY) {
      console.warn('[tts] provider=elevenlabs but ELEVENLABS_API_KEY is not set — falling back to browser');
      return 'browser';
    }
    return 'elevenlabs';
  }

  if (p === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('[tts] provider=openai but OPENAI_API_KEY is not set — falling back to browser');
      return 'browser';
    }
    return 'openai';
  }

  // auto: try ElevenLabs → OpenAI → browser
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'browser';
}

// ── Main entry point ─────────────────────────────────────

export interface TtsResult {
  provider: 'openai' | 'elevenlabs';
  wordAudioFile: string;       // relative to output/web/
  exampleAudioFiles: string[]; // relative to output/web/
}

/**
 * Generate audio files for a word record.
 * Returns null if provider is 'browser' or generation fails.
 * Files are written into {htmlOutputDir}/audio/.
 */
export async function generateAudio(
  record: WordRecord,
  wordIndex: number,
  config: AppConfig,
  htmlOutputDir: string
): Promise<TtsResult | null> {
  const provider = resolveProvider(config);

  if (provider === 'browser') return null;
  if (config.tts.provider === 'disabled') return null;

  const audioDir = path.join(htmlOutputDir, 'audio');
  const prefix = `${record.date}-${wordIndex}`;

  const wordText = `${record.word}。${record.reading}`;
  const wordFilename = `${prefix}-word.mp3`;
  const wordFilePath = path.join(audioDir, wordFilename);

  const exampleFilenames: string[] = [];

  console.log(`[tts] ${provider} → ${record.word} (${record.examples.length} example(s))`);

  try {
    // Generate word audio
    const wordAudio = await synthesize(wordText, provider, config);
    if (!wordAudio) return null;
    fs.writeFileSync(wordFilePath, wordAudio);

    // Generate example sentence audio
    for (let i = 0; i < record.examples.length; i++) {
      const exFilename = `${prefix}-ex${i}.mp3`;
      const exFilePath = path.join(audioDir, exFilename);
      const exAudio = await synthesize(record.examples[i].plain, provider, config);
      if (exAudio) {
        fs.writeFileSync(exFilePath, exAudio);
        exampleFilenames.push(`audio/${exFilename}`);
      }
    }

    return {
      provider,
      wordAudioFile: `audio/${wordFilename}`,
      exampleAudioFiles: exampleFilenames,
    };
  } catch (err) {
    console.warn(`[tts] Failed for "${record.word}": ${(err as Error).message}`);
    return null;
  }
}

// ── Synthesis dispatch ────────────────────────────────────

async function synthesize(
  text: string,
  provider: ResolvedProvider,
  config: AppConfig
): Promise<Buffer | null> {
  if (provider === 'openai') return synthesizeOpenAI(text, config);
  if (provider === 'elevenlabs') return synthesizeElevenLabs(text, config);
  return null;
}

// ── OpenAI TTS ────────────────────────────────────────────

async function synthesizeOpenAI(text: string, config: AppConfig): Promise<Buffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.tts.openai.model,
      voice: config.tts.openai.voice,
      input: text,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI TTS HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

// ── ElevenLabs TTS ────────────────────────────────────────

async function synthesizeElevenLabs(text: string, config: AppConfig): Promise<Buffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;

  const { voice_id, model_id } = config.tts.elevenlabs;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
