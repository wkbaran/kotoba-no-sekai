# 言葉の世界 — Kotoba no Sekai

**World of Words** — an automated Japanese vocabulary pipeline that discovers real vocabulary from authentic Japanese web sources.

Fetches articles from a configurable set of RSS feeds, extracts vocabulary, looks up definitions and JLPT levels, and writes ready-to-use output artifacts before exiting cleanly. Designed to run on a schedule via cron, GitHub Actions, or any task runner.

---

## Outputs

Each run produces files named by date:

| File | Description |
|------|-------------|
| `output/data/words-YYYY-MM-DD.json` | Anki-compatible JSON (note type: Basic) |
| `output/web/digest-YYYY-MM-DD.md` | Markdown reading digest with glossed examples |
| `output/web/digest-YYYY-MM-DD.html` | Self-contained HTML page, readable immediately in a browser |

Three index pages are maintained automatically:

| File | Description |
|------|-------------|
| `output/web/index.html` | Chronological archive of all daily/automated runs |
| `output/web/manual.html` | Chronological archive of all manual runs (`--word`, `--source`, `--url`) |
| `output/web/words.html` | Master word list, sorted A–Z by English definition, with JLPT level badges |

All three index pages include a nav bar linking between them. Running `--rebuild-index` regenerates all three from the existing manifests and digest files.

---

## Requirements

- Node.js 18+
- Internet access (RSS feeds + Jisho API for definitions)

---

## Setup

```bash
npm install
npm run build
cp .env.example .env   # then fill in any keys you want
```

Edit `sources.yaml` to configure your RSS feeds (see the commented examples inside).
Edit `config.yaml` to set your preferred difficulty level, output paths, TTS provider, and translation provider.

---

## Environment Variables

All keys are optional — the pipeline degrades gracefully when they are absent.
Copy `.env.example` to `.env` and fill in the ones you want.

| Variable | Used for |
|----------|----------|
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (highest-quality Japanese audio) |
| `OPENAI_API_KEY` | OpenAI TTS fallback (`tts-1` / `tts-1-hd`) |
| `GOOGLE_API_KEY` | Google Cloud Translation fallback |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 publish (falls back to `~/.aws/credentials` or IAM role if unset) |
| `AWS_REGION` | S3 region (default `us-east-1`) |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 publish |
| `DEBUG` | Print full error stack traces when set to any value |

**TTS priority (when `tts.provider = auto`):** ElevenLabs → OpenAI → browser Web Speech API
**Translation priority (when `translation.provider = auto`):** Ollama (local, no key needed) → Google Translate → disabled

---

## Usage

```bash
# Standard run — collects max_words_per_run words from shuffled feeds
npm start

# Override level or word count
node --env-file-if-exists=.env dist/index.js --level intermediate
node --env-file-if-exists=.env dist/index.js --max 10

# Manual modes — produce a 1-word digest on manual.html
node --env-file-if-exists=.env dist/index.js --word 食べる          # search all feeds for this word
node --env-file-if-exists=.env dist/index.js --source "NHK News"    # pick a word from a named source
node --env-file-if-exists=.env dist/index.js --url https://...      # pick a word from any article URL

# Utilities
node --env-file-if-exists=.env dist/index.js --dry-run              # show candidates without writing output
node --env-file-if-exists=.env dist/index.js --rebuild-index        # regenerate index.html / manual.html / words.html
node --env-file-if-exists=.env dist/index.js --publish              # sync output/web/ to S3 or R2
node --env-file-if-exists=.env dist/index.js --config path/to/config.yaml --sources path/to/sources.yaml
node --env-file-if-exists=.env dist/index.js --help
```

---

## Word Selection Algorithm

On a standard run the pipeline:

1. Fetches all articles from all enabled feeds and shuffles them together into a single flat list (feeds are shuffled first, then articles within each feed, then the combined list is shuffled again for maximum topic variety).
2. Iterates through the list one article at a time. For each article it tokenizes the text, then walks the candidate tokens in order checking: not already in the SQLite deduplication DB → Jisho lookup succeeds → JLPT level matches the configured level → at least one example sentence is found. The first candidate to pass all checks becomes a collected word.
3. At most one word is taken per article, then the pipeline advances to the next article for the next word. This ensures each collected word comes from a different topic.
4. Stops once `max_words_per_run` words are collected.

For **`--word`** the pipeline searches every article (each at most once) for any surface form of the target word using the tokenizer's base form. JLPT level and deduplication checks are skipped — you always get the word you asked for if it appears anywhere in the feeds.

For **`--source`** and **`--url`** the same per-article logic applies but restricted to a single source or fetched URL, collecting one word.

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

## Publishing

`--publish` syncs `output/web/` to a cloud storage bucket. Only new or changed files are uploaded (MD5 comparison); files deleted locally are removed from the bucket too.

Configure in `config.yaml`:

```yaml
publish:
  provider: s3        # or r2
  s3:
    bucket: my-kotoba-bucket
    region: us-east-1
  r2:
    bucket: my-kotoba-bucket
    account_id: your-cloudflare-account-id
```

**S3** — credentials from env vars, `~/.aws/credentials`, or an IAM role. For HTTPS on a custom domain, put a CloudFront distribution in front and point a Route 53 alias record at it.

**R2** — credentials from `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY`. Enable public access on the bucket to get a free `https://pub-<hash>.r2.dev` URL with no custom domain required.

Both providers are configured in the same block — you can switch between them by changing `provider`.

---

## Deduplication

Words are tracked in a local SQLite database (`output/kotoba.db`). A word is skipped on subsequent runs once it has been seen. The database and all output files are excluded from version control.

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
  "date": "2026-03-22"
}
```

Anki notes use the `Basic` note type with fields: `Front`, `Back`, `Example`, `Source`, `Level`, `Domain`.
