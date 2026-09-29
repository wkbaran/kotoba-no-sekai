import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import Database from 'better-sqlite3';
import { WordDatabase } from '../src/db';
import { cleanupTmpDirs, makeExample, makeRecord, tmpDir } from './helpers';

let dbPath: string;
let db: WordDatabase;
beforeEach(() => { dbPath = path.join(tmpDir(), 'k.db'); db = new WordDatabase(dbPath); });
afterEach(() => { try { db.close(); } catch { /* already closed */ } cleanupTmpDirs(); });

/** Read a row straight from the file, bypassing WordDatabase. */
function raw<T>(sql: string, ...params: unknown[]): T[] {
  const conn = new Database(dbPath, { readonly: true });
  try { return conn.prepare(sql).all(...params) as T[]; } finally { conn.close(); }
}

describe('seen words', () => {
  it('starts empty', () => {
    assert.equal(db.hasSeen('食べる', 'たべる'), false);
    assert.equal(db.getExampleLength('食べる', 'たべる'), -1);
  });

  it('remembers a word by word and reading together', () => {
    db.markSeen(makeRecord());
    assert.equal(db.hasSeen('食べる', 'たべる'), true);
    assert.equal(db.hasSeen('食べる', 'ちがう'), false);
    assert.equal(db.hasSeen('飲む', 'たべる'), false);
  });

  it('treats homographs with different readings as different words', () => {
    db.markSeen(makeRecord({ word: '行った', reading: 'いった' }));
    db.markSeen(makeRecord({ word: '行った', reading: 'おこなった' }));
    assert.equal(raw('SELECT * FROM seen_words').length, 2);
  });

  it('sums the example lengths', () => {
    db.markSeen(makeRecord({ examples: [makeExample({ plain: 'あいう' }), makeExample({ plain: 'えお' })] }));
    assert.equal(db.getExampleLength('食べる', 'たべる'), 5);
  });

  it('is 0 for a word with no examples', () => {
    db.markSeen(makeRecord({ examples: [] }));
    assert.equal(db.getExampleLength('食べる', 'たべる'), 0);
  });

  it('marking again updates the row instead of duplicating it', () => {
    db.markSeen(makeRecord({ date: '2026-09-01', definition: 'old', examples: [makeExample({ plain: 'あ' })] }));
    db.markSeen(makeRecord({ date: '2026-09-02', definition: 'new', examples: [makeExample({ plain: 'あいう' })] }));
    const rows = raw<{ example_length: number; seen_at: string; record_json: string }>('SELECT * FROM seen_words');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].example_length, 3);
    assert.equal(rows[0].seen_at, '2026-09-02');
    assert.equal(JSON.parse(rows[0].record_json).definition, 'new');
  });

  it('persists across connections', () => {
    db.markSeen(makeRecord());
    db.close();
    db = new WordDatabase(dbPath);
    assert.equal(db.hasSeen('食べる', 'たべる'), true);
  });

  it('resolves a relative path against the cwd', () => {
    const dir = tmpDir();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const rel = new WordDatabase('rel.db');
      rel.markSeen(makeRecord());
      rel.close();
    } finally {
      process.chdir(cwd);
    }
    const conn = new Database(path.join(dir, 'rel.db'), { readonly: true });
    try {
      assert.equal((conn.prepare('SELECT count(*) AS n FROM seen_words').get() as { n: number }).n, 1);
    } finally {
      conn.close();
    }
  });
});

describe('pickReviewWord', () => {
  it('returns null when nothing has been taught', () => {
    assert.equal(db.pickReviewWord(), null);
  });

  it('returns the stored snapshot', () => {
    const record = makeRecord();
    db.markSeen(record);
    assert.deepEqual(db.pickReviewWord(), record);
  });

  it('serves never-reviewed words first, oldest first', () => {
    db.markSeen(makeRecord({ word: 'b', reading: 'b', date: '2026-09-02' }));
    db.markSeen(makeRecord({ word: 'a', reading: 'a', date: '2026-09-01' }));
    db.markSeen(makeRecord({ word: 'c', reading: 'c', date: '2026-09-03' }));
    db.markReviewed('a', 'a', '2026-09-10');
    assert.equal(db.pickReviewWord()?.word, 'b');
    db.markReviewed('b', 'b', '2026-09-11');
    assert.equal(db.pickReviewWord()?.word, 'c');
  });

  it('then serves the least recently reviewed', () => {
    for (const w of ['a', 'b', 'c']) db.markSeen(makeRecord({ word: w, reading: w, date: '2026-09-01' }));
    db.markReviewed('a', 'a', '2026-09-12');
    db.markReviewed('b', 'b', '2026-09-10');
    db.markReviewed('c', 'c', '2026-09-11');
    assert.equal(db.pickReviewWord()?.word, 'b');
    db.markReviewed('b', 'b', '2026-09-13');
    assert.equal(db.pickReviewWord()?.word, 'c');
  });

  it('cycles through the whole pool', () => {
    for (const w of ['a', 'b', 'c']) db.markSeen(makeRecord({ word: w, reading: w, date: '2026-09-01' }));
    const order: string[] = [];
    for (let day = 10; day < 16; day++) {
      const pick = db.pickReviewWord()!;
      order.push(pick.word);
      db.markReviewed(pick.word, pick.reading, `2026-09-${day}`);
    }
    assert.deepEqual(order.slice(0, 3).sort(), ['a', 'b', 'c']);
    assert.deepEqual(order.slice(3), order.slice(0, 3));
  });

  it('skips words with no snapshot', () => {
    const conn = new Database(dbPath);
    conn.prepare("INSERT INTO seen_words (word, reading, example_length, seen_at) VALUES ('old', 'old', 0, '2026-01-01')").run();
    conn.close();
    assert.equal(db.pickReviewWord(), null);
    db.markSeen(makeRecord());
    assert.equal(db.pickReviewWord()?.word, '食べる');
  });

  it('returns null for a corrupt snapshot', () => {
    db.markSeen(makeRecord());
    const conn = new Database(dbPath);
    conn.prepare("UPDATE seen_words SET record_json = '{not json'").run();
    conn.close();
    assert.equal(db.pickReviewWord(), null);
  });
});

describe('backfillSnapshot', () => {
  function insertLegacy(word: string, reading: string, json: string | null = null): void {
    const conn = new Database(dbPath);
    conn.prepare('INSERT INTO seen_words (word, reading, example_length, seen_at, record_json) VALUES (?, ?, 0, ?, ?)')
      .run(word, reading, '2026-01-01', json);
    conn.close();
  }

  it('reports not-found for an unknown word', () => {
    assert.equal(db.backfillSnapshot(makeRecord()), 'not-found');
  });

  it('adds a snapshot where none exists, making the word reviewable', () => {
    insertLegacy('食べる', 'たべる');
    assert.equal(db.pickReviewWord(), null);
    const record = makeRecord();
    assert.equal(db.backfillSnapshot(record), 'updated');
    assert.deepEqual(db.pickReviewWord(), record);
  });

  it('leaves an existing snapshot alone', () => {
    db.markSeen(makeRecord({ definition: 'original' }));
    assert.equal(db.backfillSnapshot(makeRecord({ definition: 'replacement' })), 'already-had-one');
    assert.equal(db.pickReviewWord()?.definition, 'original');
  });
});

describe('run log', () => {
  it('records each run', () => {
    db.logRun('2026-09-01', 3, ['NHK', 'Asahi']);
    db.logRun('2026-09-02', 0, []);
    const rows = raw<{ run_date: string; word_count: number; sources: string; created_at: string }>('SELECT * FROM run_log ORDER BY id');
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].run_date, rows[0].word_count, rows[0].sources], ['2026-09-01', 3, 'NHK, Asahi']);
    assert.deepEqual([rows[1].run_date, rows[1].word_count, rows[1].sources], ['2026-09-02', 0, '']);
    assert.ok(rows[0].created_at);
  });
});

describe('schema migration', () => {
  it('adds the newer columns to a database created before them', () => {
    const legacyPath = path.join(tmpDir(), 'legacy.db');
    const legacy = new Database(legacyPath);
    legacy.exec(`CREATE TABLE seen_words (
      word TEXT NOT NULL, reading TEXT NOT NULL, example_length INTEGER NOT NULL DEFAULT 0,
      seen_at TEXT NOT NULL, PRIMARY KEY (word, reading));`);
    legacy.prepare("INSERT INTO seen_words VALUES ('猫', 'ねこ', 4, '2026-01-01')").run();
    legacy.close();

    const migrated = new WordDatabase(legacyPath);
    assert.equal(migrated.hasSeen('猫', 'ねこ'), true, 'existing rows survive');
    assert.equal(migrated.backfillSnapshot(makeRecord({ word: '猫', reading: 'ねこ' })), 'updated');
    migrated.markReviewed('猫', 'ねこ', '2026-02-01');
    assert.equal(migrated.pickReviewWord()?.word, '猫');
    migrated.close();
  });

  it('opening a current database twice does not fail', () => {
    db.close();
    assert.doesNotThrow(() => { db = new WordDatabase(dbPath); });
  });
});
