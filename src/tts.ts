import fs from 'fs';
import path from 'path';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
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
  wordAudioFile: string;
  wordAudioFileSlow?: string;
  wordAudioFileVslow?: string;
  exampleAudioFiles: string[];
  exampleAudioFilesSlow: string[];
  exampleAudioFilesVslow: string[];
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
  htmlOutputDir: string,
  slug: string
): Promise<TtsResult | null> {
  const provider = resolveProvider(config);

  if (provider === 'browser') return null;
  if (config.tts.provider === 'disabled') return null;

  const audioDir = path.join(htmlOutputDir, 'audio');
  const prefix = `${slug}-${wordIndex}`;
  const wordText = record.reading || record.word;

  const speeds = [
    { speed: 1.0,  suffix: ''       },
    { speed: 0.75, suffix: '-slow'  },
    { speed: 0.5,  suffix: '-vslow' },
  ] as const;

  console.log(`[tts] ${provider} → ${record.word} (${record.examples.length} example(s))`);

  async function gen(text: string, filename: string, speed: number): Promise<string | undefined> {
    try {
      const audio = await synthesize(text, provider, config, speed);
      if (!audio) return undefined;
      fs.writeFileSync(path.join(audioDir, filename), audio);
      return `audio/${filename}`;
    } catch (err) {
      console.warn(`[tts] Failed "${filename}" at ${speed}×: ${(err as Error).message}`);
      return undefined;
    }
  }

  const wordNormal = await gen(wordText, `${prefix}-word.mp3`,       1.0);
  if (!wordNormal) return null;
  const wordSlow   = await gen(wordText, `${prefix}-word-slow.mp3`,  0.85);
  const wordVslow  = await gen(wordText, `${prefix}-word-vslow.mp3`, 0.7);

  const exNormal: string[] = [];
  const exSlow:   string[] = [];
  const exVslow:  string[] = [];

  for (let i = 0; i < record.examples.length; i++) {
    const text = record.examples[i].plain;
    const n = await gen(text, `${prefix}-ex${i}.mp3`,       1.0);
    const s = await gen(text, `${prefix}-ex${i}-slow.mp3`,  0.85);
    const v = await gen(text, `${prefix}-ex${i}-vslow.mp3`, 0.7);
    if (n) exNormal.push(n);
    if (s) exSlow.push(s);
    if (v) exVslow.push(v);
  }

  return {
    provider,
    wordAudioFile:      wordNormal,
    wordAudioFileSlow:  wordSlow,
    wordAudioFileVslow: wordVslow,
    exampleAudioFiles:      exNormal,
    exampleAudioFilesSlow:  exSlow,
    exampleAudioFilesVslow: exVslow,
  };
}

// ── Synthesis dispatch ────────────────────────────────────

async function synthesize(
  text: string,
  provider: ResolvedProvider,
  config: AppConfig,
  speed: number
): Promise<Buffer | null> {
  if (provider === 'openai') return synthesizeOpenAI(text, config, speed);
  if (provider === 'elevenlabs') return synthesizeElevenLabs(text, config, speed);
  return null;
}

// ── OpenAI TTS ────────────────────────────────────────────

async function synthesizeOpenAI(text: string, config: AppConfig, speed: number): Promise<Buffer | null> {
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
      speed,
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

async function synthesizeElevenLabs(text: string, config: AppConfig, speed: number): Promise<Buffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;

  const { voice_id, model_id } = config.tts.elevenlabs;

  const client = new ElevenLabsClient({ apiKey: key });

  const stream = await client.textToSpeech.convert(voice_id, {
    text,
    modelId: model_id,
    languageCode: 'ja',
    outputFormat: 'mp3_44100_128',
    voiceSettings: {
      stability: 0.5,
      similarityBoost: 0.75,
      speed,
    },
  });

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
