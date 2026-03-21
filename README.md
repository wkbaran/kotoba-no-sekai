# 言葉の世界 — Kotoba no Sekai

**World of Words** — an automated Japanese vocabulary pipeline that discovers real vocabulary from authentic Japanese web sources.

Fetches articles from a configurable set of RSS feeds, extracts vocabulary, looks up definitions and JLPT levels, and writes ready-to-use output artifacts before exiting cleanly. Designed to run on a schedule via cron, GitHub Actions, or any task runner.

---

## Outputs

Each run produces three files named by date:

| File | Description |
|------|-------------|
| `output/data/words-YYYY-MM-DD.json` | Anki-compatible JSON (note type: Basic) |
| `output/web/digest-YYYY-MM-DD.md` | Markdown reading digest with glossed examples |
| `output/web/digest-YYYY-MM-DD.html` | Self-contained HTML page, readable immediately in a browser |

The HTML page links each highlighted example word directly to its source article.

---

## Requirements

- Node.js 18+
- Internet access (RSS feeds + Jisho API for definitions)

---

## Setup

```bash
npm install
npm run build
```

Edit `sources.yaml` to configure your RSS feeds (see the commented examples inside).
Edit `config.yaml` to set your preferred difficulty level and output paths.

---

## Usage

```bash
# Standard run
node dist/index.js

# Override difficulty level
node dist/index.js --level intermediate

# Override word count
node dist/index.js --max 10

# Use a different config or sources file
node dist/index.js --config path/to/config.yaml --sources path/to/sources.yaml

# Preview candidates without writing output or touching the database
node dist/index.js --dry-run

# Help
node dist/index.js --help
```

---

## Configuration

### `config.yaml`

| Setting | Default | Description |
|---------|---------|-------------|
| `level` | `beginner` | JLPT band: `beginner` (N5/N4), `intermediate` (N3), `advanced` (N2/N1), `all` |
| `max_words_per_run` | `4` | Maximum new words to collect each run |
| `max_examples_per_word` | `2` | Max example sentences per word (non-blocking) |
| `min_word_length` | `2` | Minimum character length for candidate words |
| `jisho_delay_ms` | `600` | Delay between Jisho API calls (be polite to the free API) |
| `output.json` | `output/data` | Directory for JSON output |
| `output.html` | `output/web` | Directory for HTML output |
| `output.markdown` | `output/web` | Directory for Markdown output |
| `database.path` | `output/kotoba.db` | SQLite database for deduplication |

### `sources.yaml`

RSS feeds and their domain tags. Each entry:

```yaml
feeds:
  - url: https://www3.nhk.or.jp/rss/news/cat0.xml
    domain: news
    name: NHK News
    enabled: true
```

Set `enabled: false` to disable a feed without deleting it. The file ships with NHK News, Science, and Life/Society feeds enabled, plus commented-out suggestions for NHK Web Easy and Asahi Shimbun.

---

## Deduplication

Words are tracked in a local SQLite database (`output/kotoba.db`). A word is skipped on subsequent runs unless a richer example sentence is available. The database and all output files are excluded from version control.

---

## Scheduling

**cron** (daily at 7am):
```
0 7 * * * cd /path/to/kotoba-no-sekai && node dist/index.js
```

**GitHub Actions** — create `.github/workflows/kotoba.yml`:
```yaml
on:
  schedule:
    - cron: '0 7 * * *'
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci && npm run build && node dist/index.js
```

---

## Word Record Schema

Each word in the JSON output:

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
      "plain": "日本の自然は美しい。",
      "sourceUrl": "https://..."
    }
  ],
  "sourceUrl": "https://...",
  "domain": "science",
  "jlptLevel": "N4",
  "date": "2026-03-21"
}
```

Anki notes use the `Basic` note type with fields: `Front`, `Back`, `Example`, `Source`, `Level`, `Domain`.
