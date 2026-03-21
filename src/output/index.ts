import fs from 'fs';
import path from 'path';
import type { WordRecord } from '../types.js';
import { resolveOutputPath } from '../config.js';

// ── Manifest ─────────────────────────────────────────────

interface ManifestEntry {
  date: string;
  wordCount: number;
  words: string[];        // kanji forms, for the preview
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
  // Sort newest first
  entries.sort((a, b) => b.date.localeCompare(a.date));
  saveManifest(outputDir, entries);
  return entries;
}

// ── HTML ──────────────────────────────────────────────────

function buildIndexPage(entries: ManifestEntry[]): string {
  const rows = entries.map(entry => {
    const preview = entry.words.slice(0, 6).join('　');
    return `
    <a class="entry" href="${entry.file}">
      <span class="entry-date">${entry.date}</span>
      <span class="entry-count">${entry.wordCount} word${entry.wordCount !== 1 ? 's' : ''}</span>
      <span class="entry-preview">${preview}</span>
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
      display: grid;
      grid-template-columns: 7rem 5rem 1fr;
      align-items: center;
      gap: 1rem;
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
      font-size: 1rem;
      letter-spacing: .05em;
      color: var(--muted);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
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
      .entry {
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
      }
      .entry-preview {
        grid-column: 1 / -1;
        font-size: .9rem;
      }
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
    words: records.map(r => r.word),
    file: `digest-${date}.html`,
  };

  const entries = upsertManifest(outputDir, entry);
  const html = buildIndexPage(entries);

  const indexPath = resolveOutputPath(outputDir, 'index.html');
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`[output] Index → ${indexPath}`);
}
