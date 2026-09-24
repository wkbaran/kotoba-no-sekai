# CLI

Everything runs through `dist/index.js`. `npm start` runs it with your `.env` loaded, so pass options after `--`.

```bash
npm run build
npm start                     # the daily run
npm start -- --help           # every option
```

## Commands

```bash
# Daily run: collects max_words_per_run words from the shuffled feeds
npm start
npm start -- --level intermediate     # override the JLPT band for this run
npm start -- --max 10                 # override the number of words

# Custom runs: one word, listed under Custom instead of Days
npm start -- --word 食べる             # search every feed for this word
npm start -- --source "NHK News"       # pick a word from one named source
npm start -- --url https://...         # pick a word from one article

# Utilities
npm start -- --dry-run                # show candidates without writing anything
npm start -- --rebuild-index          # regenerate the Days, Custom and All words pages
npm start -- --rebuild-digests        # re-render every day's page in the current design
npm start -- --backfill-reviews       # store review snapshots from older words-*.json files
npm start -- --publish                # sync output/web/ to S3 or R2
npm start -- --config path/to/config.yaml --sources path/to/sources.yaml
```

## Output

Each run writes files named by date. A second run on the same day gets a suffix, as in `digest-2026-03-23-2.html`.

| File | What it is |
|---|---|
| `output/web/digest-YYYY-MM-DD.html` | The day's study page. Self-contained apart from its audio files and web fonts |
| `output/web/digest-YYYY-MM-DD.md` | The same words as a Markdown reading digest |
| `output/web/audio/` | Word and sentence audio at three speeds, when a TTS provider is configured |
| `output/data/words-YYYY-MM-DD.json` | Anki-ready notes plus the full word records |
| `output/kotoba.db` | SQLite database of words already taught and when each was last reviewed |

The site pages are rebuilt on every run:

| File | Page |
|---|---|
| `output/web/index.html` | **Days**: the newest words and a calendar of every day |
| `output/web/words.html` | **All words**: search, JLPT filter, sort, and a self-test mode |
| `output/web/manual.html` | **Custom**: custom runs. Linked from the nav once one exists |

Writing a new day also turns the previous day's "Next day" button into a link. `--rebuild-digests` re-renders every day from its JSON file, which is how older pages pick up design changes.

## How words are chosen

On a daily run the pipeline:

1. Fetches every article from every enabled feed and shuffles them together (feeds first, then articles within each feed, then the combined list), so the words come from different topics.
2. Goes through the articles one at a time. For each, it splits the text into words and checks the candidates in order: not already in the database, found on Jisho, at the configured JLPT level, and used in at least one example sentence. The first candidate that passes is collected.
3. Takes at most one word per article, then moves to the next article.
4. Stops once it has `max_words_per_run` words.

Then it picks one earlier word for review: words never reviewed come first, oldest first, then whichever was reviewed longest ago, so every word you've learned comes around again.

**`--word`** searches every article (each at most once) for any form of the word, matching on the dictionary form, so `--word 食べる` finds 食べた. It skips the JLPT and already-seen checks, so you always get the word if it appears anywhere in the feeds.

**`--source`** and **`--url`** use the daily logic, limited to one source or one article, and collect one word.

## Word record

Each word in `words-*.json`:

```json
{
  "word": "自然",
  "reading": "しぜん",
  "pos": "Noun",
  "definition": "nature",
  "altDefinitions": ["spontaneous", "natural"],
  "examples": [
    {
      "markedHtml": "日本の<mark>自然</mark>は美しい。",
      "glossedHtml": "…the same sentence with <ruby> furigana and lookup links…",
      "plain": "日本の自然は美しい。",
      "sourceUrl": "https://...",
      "articleText": "…a saved copy of the article…",
      "translation": "Japan's nature is beautiful.",
      "audioFile": "audio/2026-03-22-0-ex0.mp3"
    }
  ],
  "sourceUrl": "https://...",
  "domain": "science",
  "jlptLevel": "N4",
  "date": "2026-03-22",
  "wordAudioFile": "audio/2026-03-22-0-word.mp3"
}
```

Audio fields also come in `…Slow` and `…Vslow` versions. Anki notes use the `Basic` note type with the fields `Front`, `Back`, `Example`, `Source`, `Level` and `Domain`.
