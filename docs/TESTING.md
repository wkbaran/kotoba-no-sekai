# Testing

```bash
npm test                # the whole suite, about 15 seconds
npm run test:coverage   # the same, with a coverage report for src/
node --require ./scripts/register.cjs --test test/db.test.ts   # one file
```

The suite uses Node's built-in test runner (`node:test`) and the `ts-node` already in devDependencies, so there is nothing extra to install. It was written and run on Node 22; other versions are untested (the coverage flags and the mocked clock need reasonably recent Node releases). It never touches the network, `output/`, or your real database: every test works in a temporary directory and fakes `fetch` or serves from a local HTTP server.

## What is covered

| File | What it tests |
| --- | --- |
| `conjugation.test.ts` | Every verb and adjective class, the irregular cases, and finding forms in sentences |
| `config.test.ts` | Defaults, merging, validation, the `OLLAMA_*` overrides, `sources.yaml`, run slugs |
| `db.test.ts` | Dedup, review-word selection and cycling, snapshot backfill, schema migration |
| `dictionary.test.ts` | Jisho parsing, throttling, 429 backoff, and the failure limits that abort a run |
| `tokenizer.test.ts`, `sentences.test.ts` | Candidate filtering, sentence splitting, clause trimming, furigana HTML (fake tokens and real kuromoji) |
| `rss.test.ts`, `json-feed.test.ts`, `scraper.test.ts`, `feeds.test.ts` | Feed parsing, inline versus scraped text, HTML extraction |
| `translation.test.ts`, `tts.test.ts`, `publish.test.ts` | Provider selection, Ollama retries, OpenAI and ElevenLabs audio, S3/R2 sync and CloudFront |
| `output-*.test.ts` | JSON, Markdown, the digest page, the index pages, the manifests |
| `pipeline.test.ts` | Whole runs (all four modes) against fake feeds and Jisho, with real kuromoji and SQLite |
| `cli.test.ts` | The real `src/index.ts` in a child process |
| `repo-config.test.ts` | The shipped `config.yaml` and `sources.yaml` are valid |

## Conventions

- **Sandbox the environment.** Call `setEnv()` from `test/helpers.ts` in `beforeEach` (and its result in `afterEach`). It clears `OLLAMA_HOST`, the API keys and the rest, so a variable set in your shell cannot change a result.
- **Use temporary directories.** `tmpDir()` and `cleanupTmpDirs()` in `helpers.ts`. Configs from `makeConfig(root)` keep every path, including the database, inside `root` and switch off TTS and translation.
- **Fake time, not sleeps.** Code that waits (Jisho's throttle, Ollama's retries) is tested with `mock.timers` and `drive()`, which advances the clock while a promise is waiting.
- **Jisho's state is per process.** `dictionary.ts` counts failures at module level, so `dictionary.test.ts` loads a fresh copy per test. In `pipeline.test.ts` the outage test is last for the same reason.
- **`todo` marks a known bug.** When you find a bug you are not fixing right away, write a test for the behaviour the code should have and add `{ todo: '...' }`. It runs and is reported, but does not fail the suite, and it starts passing when the bug is fixed; remove the `todo` then. There are none at the moment.
