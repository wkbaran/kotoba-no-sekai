// ────────────────────────────────────────────────────────
// Shared types for Kotoba no Sekai
// ────────────────────────────────────────────────────────

export type Level = 'beginner' | 'intermediate' | 'advanced' | 'all';
export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1' | 'unknown';
export type TtsProvider = 'auto' | 'openai' | 'elevenlabs' | 'browser' | 'disabled';
export type TranslationProvider = 'auto' | 'ollama' | 'google' | 'disabled';

// ── Config ──────────────────────────────────────────────

export interface AppConfig {
  level: Level;
  max_words_per_run: number;
  max_examples_per_word: number;
  min_word_length: number;
  jisho_delay_ms: number;
  output: {
    json: string;
    html: string;
    markdown: string;
  };
  database: {
    path: string;
  };
  tts: {
    provider: TtsProvider;
    openai: {
      voice: string;
      model: string;
    };
    elevenlabs: {
      voice_id: string;
      model_id: string;
    };
  };
  translation: {
    provider: TranslationProvider;
    ollama: {
      url: string;
      model: string;
    };
    google: {
      // API key read from GOOGLE_API_KEY env var
    };
  };
}

export interface FeedSource {
  url: string;
  domain: string;
  name: string;
  enabled: boolean;
}

export interface SourcesConfig {
  feeds: FeedSource[];
}

// ── Pipeline ─────────────────────────────────────────────

export interface ArticleContent {
  url: string;
  title: string;
  domain: string;
  text: string; // plain text, sentences separated by spaces
}

export interface CandidateToken {
  surface: string;   // word as it appears in the article
  baseForm: string;  // dictionary form (基本形)
  reading: string;   // hiragana reading
  pos: string;       // part of speech (日本語)
}

// ── Word record (core output unit) ───────────────────────

export interface ExampleSentence {
  /** Source sentence with target word wrapped in <mark> tags */
  markedHtml: string;
  /** Plain text version (no HTML tags) */
  plain: string;
  sourceUrl: string;
  /** Relative path from output/web/ to generated audio file, if any */
  audioFile?: string;
  /** English translation of the example sentence */
  translation?: string;
}

export interface WordRecord {
  /** Word in kanji (or kana if no kanji form) */
  word: string;
  /** Hiragana reading */
  reading: string;
  /** English part of speech */
  pos: string;
  /** Primary English definition */
  definition: string;
  /** Additional definitions */
  altDefinitions: string[];
  /** Example sentences from the source, with <mark> tags */
  examples: ExampleSentence[];
  /** URL of the source article */
  sourceUrl: string;
  /** Domain tag from sources.yaml */
  domain: string;
  /** JLPT level estimate */
  jlptLevel: JlptLevel;
  /** ISO date string of the run */
  date: string;
  /** Relative path from output/web/ to word pronunciation audio file, if any */
  wordAudioFile?: string;
  /** Which TTS provider generated the audio (for display purposes) */
  audioProvider?: 'openai' | 'elevenlabs';
}

// ── Anki-compatible JSON schema ───────────────────────────

export interface AnkiNote {
  noteType: 'Basic';
  fields: {
    Front: string;   // word + reading
    Back: string;    // definition
    Example: string; // example sentence (HTML)
    Source: string;  // article URL
    Level: string;   // JLPT level
    Domain: string;  // domain tag
  };
}

export interface RunOutput {
  date: string;
  feedName: string;
  wordCount: number;
  words: WordRecord[];
}
