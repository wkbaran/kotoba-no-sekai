# Configuration

Three files control a run: `config.yaml` for behaviour, `sources.yaml` for the feeds, and `.env` for keys. All three are optional; missing settings fall back to the defaults below.

## `config.yaml`

| Setting | Default | What it does |
|---|---|---|
| `level` | `beginner` | JLPT band: `beginner` (N5 and N4), `intermediate` (N3), `advanced` (N2 and N1), or `all` (including words with no JLPT level) |
| `max_words_per_run` | `4` | New words to collect each run. The shipped config uses 3 |
| `max_examples_per_word` | `2` | Most example sentences to keep per word. A word with fewer is still kept |
| `min_word_length` | `2` | Shortest word to consider, in characters. Filters out stray particles |
| `jisho_delay_ms` | `1250` | Pause between Jisho lookups. Jisho rate-limits above 10 requests per 10 seconds, so lower values are raised to 1250 |
| `fetch_concurrency` | `3` | Articles fetched and analyzed at once. Jisho lookups always run one at a time |
| `output.json` | `output/data` | Where the JSON files go |
| `output.html` | `output/web` | Where the site goes |
| `output.markdown` | `output/web` | Where the Markdown digests go |
| `database.path` | `output/kotoba.db` | The SQLite database of words already taught |
| `tts.provider` | `auto` | `auto` (ElevenLabs, then OpenAI, then the browser), `elevenlabs`, `openai`, `browser`, or `disabled` |
| `tts.openai.voice`, `.model` | `alloy`, `tts-1` | OpenAI voice and model (`tts-1-hd` is higher quality) |
| `tts.elevenlabs.voice_id`, `.model_id` | Lily, `eleven_multilingual_v2` | ElevenLabs voice and model |
| `translation.provider` | `auto` | `auto` (Ollama if reachable, then Google), `ollama`, `google`, or `disabled` |
| `translation.ollama.url`, `.model` | `http://localhost:11434`, `translategemma:27b` | The Ollama server and model used to translate example sentences |
| `publish` | none | See [Publishing](PUBLISHING.md) |

## `sources.yaml`

Each feed has a URL, a domain tag and a name:

```yaml
feeds:
  - url: https://www3.nhk.or.jp/rss/news/cat0.xml
    domain: news
    name: NHK News
    enabled: true
```

Set `enabled: false` to turn a feed off without deleting it. The shipped file has NHK News, NHK Science & Culture, NHK Life & Society, NHK Web Easy (via NHK Easier), Asahi Shimbun and Watanoc enabled, with more suggestions commented out.

A source can also be a JSON API instead of RSS. Set `type: json` and map the response's fields with a `json` block; the comments at the top of `sources.yaml` show the format.

## Environment variables

Copy `.env.example` to `.env` and fill in what you use. None are required.

| Variable | Used for |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs audio, the best-sounding Japanese voices |
| `OPENAI_API_KEY` | OpenAI audio, used if ElevenLabs isn't set up |
| `OLLAMA_HOST` | Ollama URL for translation. Overrides `translation.ollama.url`; a bare `host:port` works |
| `OLLAMA_MODEL` | Overrides `translation.ollama.model` |
| `OLLAMA_API_KEY` | Sent as a Bearer token, for a proxied or hosted Ollama |
| `GOOGLE_API_KEY` | Google Cloud Translation, used if Ollama isn't reachable |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 publishing. Falls back to `~/.aws/credentials` or an IAM role |
| `AWS_REGION` | S3 region, default `us-east-1` |
| `S3_BUCKET` | Bucket, if not set in `config.yaml` |
| `CLOUDFRONT_DISTRIBUTION_ID` | If set, `--publish` clears the CloudFront cache afterwards |
| `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 publishing |
| `R2_BUCKET` | Bucket, if not set in `config.yaml` |
| `DEBUG` | Any value prints full stack traces on errors |
