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
        record_json      TEXT,
        last_reviewed_at TEXT,
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
    this.migrateColumns();
  }

  /** Add columns introduced after the table was first created, for existing databases. */
  private migrateColumns(): void {
    const columns = this.db.prepare(`PRAGMA table_info(seen_words)`).all() as { name: string }[];
    const names = new Set(columns.map(c => c.name));
    if (!names.has('record_json')) {
      this.db.exec(`ALTER TABLE seen_words ADD COLUMN record_json TEXT`);
    }
    if (!names.has('last_reviewed_at')) {
      this.db.exec(`ALTER TABLE seen_words ADD COLUMN last_reviewed_at TEXT`);
    }
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
        INSERT INTO seen_words (word, reading, example_length, seen_at, record_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(word, reading) DO UPDATE SET
          example_length = excluded.example_length,
          seen_at = excluded.seen_at,
          record_json = excluded.record_json
      `)
      .run(record.word, record.reading, exampleLength, record.date, JSON.stringify(record));
  }

  /**
   * Pick a previously-taught word to resurface for review: words never
   * reviewed before come first (oldest-taught first), then the
   * least-recently-reviewed one, so the whole learned pool cycles over time.
   * Only words with a stored snapshot are eligible — words learned before
   * this feature shipped won't be until they're re-taught.
   */
  pickReviewWord(): WordRecord | null {
    const row = this.db
      .prepare(`
        SELECT record_json FROM seen_words
        WHERE record_json IS NOT NULL
        ORDER BY
          CASE WHEN last_reviewed_at IS NULL THEN 0 ELSE 1 END,
          COALESCE(last_reviewed_at, seen_at) ASC
        LIMIT 1
      `)
      .get() as { record_json: string } | undefined;

    if (!row) return null;
    try {
      return JSON.parse(row.record_json) as WordRecord;
    } catch {
      return null;
    }
  }

  /**
   * Fill in record_json for a seen word that doesn't have one yet, so it
   * becomes eligible for review. Returns 'updated', 'already-had-one', or
   * 'not-found' (no matching seen_words row for this word/reading).
   */
  backfillSnapshot(record: WordRecord): 'updated' | 'already-had-one' | 'not-found' {
    const row = this.db
      .prepare('SELECT record_json FROM seen_words WHERE word = ? AND reading = ?')
      .get(record.word, record.reading) as { record_json: string | null } | undefined;

    if (!row) return 'not-found';
    if (row.record_json) return 'already-had-one';

    this.db
      .prepare('UPDATE seen_words SET record_json = ? WHERE word = ? AND reading = ?')
      .run(JSON.stringify(record), record.word, record.reading);
    return 'updated';
  }

  markReviewed(word: string, reading: string, date: string): void {
    this.db
      .prepare('UPDATE seen_words SET last_reviewed_at = ? WHERE word = ? AND reading = ?')
      .run(date, word, reading);
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
