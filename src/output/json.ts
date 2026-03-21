import fs from 'fs';
import type { WordRecord, AnkiNote, RunOutput } from '../types.js';
import { resolveOutputPath } from '../config.js';

export function buildAnkiNote(record: WordRecord): AnkiNote {
  const front = `${record.word}【${record.reading}】`;
  const back = `${record.definition}`;
  const example = record.examples.map(e => e.markedHtml).join('<br><br>');
  const source = record.sourceUrl;

  return {
    noteType: 'Basic',
    fields: {
      Front: front,
      Back: back,
      Example: example,
      Source: source,
      Level: record.jlptLevel,
      Domain: record.domain,
    },
  };
}

export function writeJsonOutput(
  records: WordRecord[],
  date: string,
  outputDir: string
): string {
  const output: RunOutput = {
    date,
    feedName: records[0]?.domain ?? 'unknown',
    wordCount: records.length,
    words: records,
  };

  const ankiNotes = records.map(buildAnkiNote);

  const payload = {
    meta: {
      date,
      wordCount: records.length,
      generator: 'kotoba-no-sekai',
    },
    ankiNotes,
    fullRecords: output.words,
  };

  const filename = `words-${date}.json`;
  const outPath = resolveOutputPath(outputDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[output] JSON → ${outPath}`);
  return outPath;
}
