import Database from 'better-sqlite3';
import path from 'path';
import type { WordRecord } from './types.js';

export interface SeenWord {
  word: string;
  reading: string;
  exampleLength: number;
  seenAt: string;
}

export class WordDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const resolved = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
    this.db = new Database(resolved);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seen_words (
        word          TEXT NOT NULL,
        reading       TEXT NOT NULL,
        example_length INTEGER NOT NULL DEFAULT 0,
        seen_at       TEXT NOT NULL,
        PRIMARY KEY (word, reading)
      );

      CREATE TABLE IF NOT EXISTS run_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        run_date   TEXT NOT NULL,
        word_count INTEGER NOT NULL,
        sources    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  hasSeen(word: string, reading: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM seen_words WHERE word = ? AND reading = ?')
      .get(word, reading);
    return row !== undefined;
  }

  /** Returns existing example length, or -1 if word not seen */
  getExampleLength(word: string, reading: string): number {
    const row = this.db
      .prepare('SELECT example_length FROM seen_words WHERE word = ? AND reading = ?')
      .get(word, reading) as { example_length: number } | undefined;
    return row ? row.example_length : -1;
  }

  markSeen(record: WordRecord): void {
    const exampleLength = record.examples.reduce((sum, ex) => sum + ex.plain.length, 0);
    this.db
      .prepare(`
        INSERT INTO seen_words (word, reading, example_length, seen_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(word, reading) DO UPDATE SET
          example_length = excluded.example_length,
          seen_at = excluded.seen_at
      `)
      .run(record.word, record.reading, exampleLength, record.date);
  }

  logRun(date: string, wordCount: number, sources: string[]): void {
    this.db
      .prepare('INSERT INTO run_log (run_date, word_count, sources) VALUES (?, ?, ?)')
      .run(date, wordCount, sources.join(', '));
  }

  close(): void {
    this.db.close();
  }
}
