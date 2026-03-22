import fs from 'fs';
import path from 'path';
import type { WordRecord } from '../types.js';
import { resolveOutputPath } from '../config.js';

// ── Manifest ─────────────────────────────────────────────

interface ManifestWord {
  word: string;
  definition: string;
}

interface ManifestEntry {
  date: string;
  wordCount: number;
  words: ManifestWord[];  // word + definition pairs, for the preview
  file: string;           // relative filename, e.g. digest-2026-03-21.html
}

function manifestPath(outputDir: string): string {
  return resolveOutputPath(outputDir, 'manifest.json');
}

function loadManifest(outputDir: string): ManifestEntry[] {
  const p = manifestPath(outputDir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ManifestEntry[];
  } catch {
    return [];
  }
}

function saveManifest(outputDir: string, entries: ManifestEntry[]): void {
  fs.writeFileSync(manifestPath(outputDir), JSON.stringify(entries, null, 2), 'utf8');
}

function upsertManifest(outputDir: string, entry: ManifestEntry): ManifestEntry[] {
  const entries = loadManifest(outputDir).filter(e => e.date !== entry.date);
  entries.push(entry);

  // Also pick up any digest-*.html files on disk that aren't in the manifest yet
  // (e.g. from runs before the index feature existed, or after a manifest reset)
  const resolvedDir = path.resolve(process.cwd(), outputDir);
  try {
    const known = new Set(entries.map(e => e.date));
    for (const f of fs.readdirSync(resolvedDir)) {
      const m = f.match(/^digest-(\d{4}-\d{2}-\d{2})\.html$/);
      if (m && !known.has(m[1])) {
        entries.push({ date: m[1], wordCount: 0, words: [] as ManifestWord[], file: f });
        known.add(m[1]);
      }
    }
  } catch { /* output dir may not exist yet on very first run */ }

  // Sort newest first
  entries.sort((a, b) => b.date.localeCompare(a.date));
  saveManifest(outputDir, entries);
  return entries;
}

// ── HTML ──────────────────────────────────────────────────

function buildIndexPage(entries: ManifestEntry[]): string {
  const rows = entries.map(entry => {
    const chips = entry.words.slice(0, 6).map(w =>
      `<span class="word-chip"><span class="chip-word">${w.word}</span><span class="chip-def">${w.definition}</span></span>`
    ).join('');
    return `
    <a class="entry" href="${entry.file}">
      <div class="entry-meta">
        <span class="entry-date">${entry.date}</span>
        <span class="entry-count">${entry.wordCount} word${entry.wordCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="entry-preview">${chips}</div>
    </a>`;
  }).join('\n');

  const empty = entries.length === 0
    ? '<p class="empty">No digests yet. Run <code>node dist/index.js</code> to generate the first one.</p>'
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>言葉の世界 — Archive</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --surface:  #1e1e2e;
      --bg:       #13131f;
      --text:     #cdd6f4;
      --muted:    #6c7086;
      --accent:   #89b4fa;
      --border:   #313244;
      --hover:    #262637;
      --shadow:   0 2px 12px rgba(0,0,0,.4);
      --radius:   10px;
    }

    [data-theme="light"] {
      --surface:  #ffffff;
      --bg:       #f8f9fa;
      --text:     #212529;
      --muted:    #6c757d;
      --accent:   #5c6bc0;
      --border:   #dee2e6;
      --hover:    #f1f3f5;
      --shadow:   0 2px 8px rgba(0,0,0,.08);
    }

    body {
      font-family: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem 1rem;
      min-height: 100vh;
      transition: background .25s, color .25s;
    }

    .site-header {
      text-align: center;
      margin-bottom: 2.5rem;
      position: relative;
    }

    .site-title {
      font-size: 2rem;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: .05em;
    }

    .site-subtitle {
      color: var(--muted);
      font-size: .9rem;
      margin-top: .25rem;
    }

    .theme-toggle {
      position: absolute;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 20px;
      padding: .3em .75em;
      font-size: .8rem;
      cursor: pointer;
      transition: color .2s, border-color .2s;
    }

    .theme-toggle:hover { color: var(--text); border-color: var(--muted); }

    .entry-list {
      max-width: 680px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: .5rem;
    }

    .entry {
      display: flex;
      flex-direction: column;
      gap: .6rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: .85rem 1.25rem;
      text-decoration: none;
      color: var(--text);
      box-shadow: var(--shadow);
      transition: background .15s, border-color .15s;
    }

    .entry:hover {
      background: var(--hover);
      border-color: var(--accent);
    }

    .entry-meta {
      display: flex;
      align-items: baseline;
      gap: .75rem;
    }

    .entry-date {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--accent);
    }

    .entry-count {
      font-size: .8rem;
      color: var(--muted);
      white-space: nowrap;
    }

    .entry-preview {
      display: flex;
      flex-wrap: wrap;
      gap: .4rem;
    }

    .word-chip {
      display: inline-flex;
      align-items: baseline;
      gap: .3rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: .2em .55em;
      font-size: .85rem;
    }

    .chip-word {
      font-weight: 600;
      color: var(--text);
    }

    .chip-def {
      color: var(--muted);
      font-size: .78rem;
    }

    .empty {
      text-align: center;
      color: var(--muted);
      padding: 3rem 0;
    }

    .empty code {
      background: var(--surface);
      padding: .1em .4em;
      border-radius: 4px;
      font-size: .9em;
    }

    .site-footer {
      text-align: center;
      margin-top: 3rem;
      color: var(--muted);
      font-size: .8rem;
    }

    @media (max-width: 480px) {
      .word-chip { font-size: .8rem; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <h1 class="site-title">言葉の世界</h1>
    <p class="site-subtitle">${entries.length} digest${entries.length !== 1 ? 's' : ''}</p>
    <button class="theme-toggle" id="themeToggle" aria-label="Toggle light/dark mode">☀ Light</button>
  </header>

  <div class="entry-list">
    ${rows}
    ${empty}
  </div>

  <footer class="site-footer">
    <p>言葉の世界 — World of Words</p>
  </footer>

  <script>
    (function () {
      var btn = document.getElementById('themeToggle');
      var stored = localStorage.getItem('kotoba-theme');
      if (stored === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        btn.textContent = '🌙 Dark';
      }
      btn.addEventListener('click', function () {
        var isLight = document.documentElement.getAttribute('data-theme') === 'light';
        if (isLight) {
          document.documentElement.removeAttribute('data-theme');
          btn.textContent = '☀ Light';
          localStorage.setItem('kotoba-theme', 'dark');
        } else {
          document.documentElement.setAttribute('data-theme', 'light');
          btn.textContent = '🌙 Dark';
          localStorage.setItem('kotoba-theme', 'light');
        }
      });
    })();
  </script>
</body>
</html>`;
}

// ── Public API ────────────────────────────────────────────

export function writeIndexOutput(
  records: WordRecord[],
  date: string,
  outputDir: string
): void {
  const entry: ManifestEntry = {
    date,
    wordCount: records.length,
    words: records.map(r => ({ word: r.word, definition: r.definition })),
    file: `digest-${date}.html`,
  };

  const entries = upsertManifest(outputDir, entry);
  const html = buildIndexPage(entries);

  const indexPath = resolveOutputPath(outputDir, 'index.html');
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`[output] Index → ${indexPath}`);
}

/**
 * Rebuild the index from the existing manifest + any digest HTML files on disk,
 * without adding a new run entry. Useful for recovering a lost or stale index.
 */
export function rebuildIndexOutput(outputDir: string): void {
  const resolvedDir = path.resolve(process.cwd(), outputDir);
  const entries = loadManifest(outputDir);
  const known = new Set(entries.map(e => e.date));

  try {
    for (const f of fs.readdirSync(resolvedDir)) {
      const m = f.match(/^digest-(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.html$/);
      if (m && !known.has(m[1])) {
        entries.push({ date: m[1], wordCount: 0, words: [], file: f });
        known.add(m[1]);
      }
    }
  } catch (err) {
    console.error(`[index] Could not read output directory: ${(err as Error).message}`);
    process.exit(1);
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  saveManifest(outputDir, entries);

  const html = buildIndexPage(entries);
  const indexPath = resolveOutputPath(outputDir, 'index.html');
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`[output] Index rebuilt → ${indexPath} (${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'})`);
}
