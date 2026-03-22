import fs from 'fs';
import path from 'path';
import type { WordRecord } from '../types.js';
import { resolveOutputPath } from '../config.js';

// ── Types ─────────────────────────────────────────────────

interface ManifestWord {
  word: string;
  definition: string;
  jlptLevel?: string;
}

interface ManifestEntry {
  date: string;
  wordCount: number;
  words: ManifestWord[];
  file: string;
}

type RunMode = 'auto' | 'manual';

const MANIFEST_FILES: Record<RunMode, string> = {
  auto:   'manifest.json',
  manual: 'manual-manifest.json',
};

const INDEX_FILES: Record<RunMode, string> = {
  auto:   'index.html',
  manual: 'manual.html',
};

const INDEX_TITLES: Record<RunMode, string> = {
  auto:   '言葉の世界 — Archive',
  manual: '言葉の世界 — Custom Runs',
};

const INDEX_HEADINGS: Record<RunMode, string> = {
  auto:   '言葉の世界',
  manual: '言葉の世界 — Custom',
};

// ── Manifest helpers ──────────────────────────────────────

function manifestPath(outputDir: string, mode: RunMode): string {
  return resolveOutputPath(outputDir, MANIFEST_FILES[mode]);
}

function loadManifest(outputDir: string, mode: RunMode): ManifestEntry[] {
  const p = manifestPath(outputDir, mode);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ManifestEntry[];
  } catch {
    return [];
  }
}

function saveManifest(outputDir: string, mode: RunMode, entries: ManifestEntry[]): void {
  fs.writeFileSync(manifestPath(outputDir, mode), JSON.stringify(entries, null, 2), 'utf8');
}

function upsertManifest(outputDir: string, mode: RunMode, entry: ManifestEntry): ManifestEntry[] {
  const entries = loadManifest(outputDir, mode).filter(e => e.date !== entry.date);
  entries.push(entry);

  // For auto runs: also pick up any digest-*.html files on disk not yet in the manifest
  if (mode === 'auto') {
    const resolvedDir = path.resolve(process.cwd(), outputDir);
    try {
      const known = new Set(entries.map(e => e.date));
      for (const f of fs.readdirSync(resolvedDir)) {
        const m = f.match(/^digest-(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.html$/);
        if (m && !known.has(m[1])) {
          entries.push({ date: m[1], wordCount: 0, words: [], file: f });
          known.add(m[1]);
        }
      }
    } catch { /* output dir may not exist yet */ }
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  saveManifest(outputDir, mode, entries);
  return entries;
}

// ── Index page HTML ───────────────────────────────────────

function buildIndexPage(entries: ManifestEntry[], mode: RunMode): string {
  const rows = entries.map(entry => {
    const chips = entry.words.slice(0, 6).map(w => {
      const mw = typeof w === 'string' ? { word: w as string, definition: '', jlptLevel: '' } : w;
      return mw.definition
        ? `<span class="word-chip"><span class="chip-word">${mw.word}</span><span class="chip-def">${mw.definition}</span></span>`
        : `<span class="word-chip"><span class="chip-word">${mw.word}</span></span>`;
    }).join('');
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
  <title>${INDEX_TITLES[mode]}</title>
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

    .site-header { text-align: center; margin-bottom: 2.5rem; position: relative; }

    .site-title { font-size: 2rem; font-weight: 700; color: var(--accent); letter-spacing: .05em; }
    .site-subtitle { color: var(--muted); font-size: .9rem; margin-top: .25rem; }

    .nav-links {
      margin-top: .6rem;
      display: flex;
      justify-content: center;
      gap: 1.5rem;
      font-size: .85rem;
    }

    .nav-links a { color: var(--accent); text-decoration: none; opacity: .75; }
    .nav-links a:hover { opacity: 1; }
    .nav-links a.active { opacity: 1; font-weight: 600; text-decoration: underline; }

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

    .entry:hover { background: var(--hover); border-color: var(--accent); }

    .entry-meta { display: flex; align-items: baseline; gap: .75rem; }

    .entry-date { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--accent); }
    .entry-count { font-size: .8rem; color: var(--muted); white-space: nowrap; }

    .entry-preview { display: flex; flex-wrap: wrap; gap: .4rem; }

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

    .chip-word { font-weight: 600; color: var(--text); }
    .chip-def  { color: var(--muted); font-size: .78rem; }

    .empty { text-align: center; color: var(--muted); padding: 3rem 0; }
    .empty code { background: var(--surface); padding: .1em .4em; border-radius: 4px; font-size: .9em; }

    .site-footer { text-align: center; margin-top: 3rem; color: var(--muted); font-size: .8rem; }

    @media (max-width: 480px) { .word-chip { font-size: .8rem; } }
  </style>
</head>
<body>
  <header class="site-header">
    <h1 class="site-title">${INDEX_HEADINGS[mode]}</h1>
    <p class="site-subtitle">${entries.length} digest${entries.length !== 1 ? 's' : ''}</p>
    <nav class="nav-links">
      <a href="index.html"${mode === 'auto' ? ' class="active"' : ''}>Daily</a>
      <a href="manual.html"${mode === 'manual' ? ' class="active"' : ''}>Custom</a>
      <a href="words.html">All Words</a>
    </nav>
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

// ── Master words index ────────────────────────────────────

interface WordRow {
  word: string;
  definition: string;
  jlptLevel: string;
  file: string;
}

function buildWordsPage(rows: WordRow[]): string {
  const tableRows = rows.map(r => {
    const levelClass = r.jlptLevel ? `level-${r.jlptLevel.toLowerCase()}` : 'level-unknown';
    const levelBadge = r.jlptLevel
      ? `<span class="badge ${levelClass}">${r.jlptLevel}</span>`
      : '';
    return `  <tr>
    <td class="col-def"><a href="${r.file}">${r.definition || '—'}</a></td>
    <td class="col-word"><a href="${r.file}">${r.word}</a></td>
    <td class="col-level">${levelBadge}</td>
  </tr>`;
  }).join('\n');

  const empty = rows.length === 0
    ? '<tr><td colspan="3" class="empty">No words yet.</td></tr>'
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>言葉の世界 — All Words</title>
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

    .site-header { text-align: center; margin-bottom: 2.5rem; position: relative; }

    .site-title { font-size: 2rem; font-weight: 700; color: var(--accent); letter-spacing: .05em; }
    .site-subtitle { color: var(--muted); font-size: .9rem; margin-top: .25rem; }

    .nav-links {
      margin-top: .6rem;
      display: flex;
      justify-content: center;
      gap: 1.5rem;
      font-size: .85rem;
    }

    .nav-links a { color: var(--accent); text-decoration: none; opacity: .75; }
    .nav-links a:hover { opacity: 1; }
    .nav-links a.active { opacity: 1; font-weight: 600; text-decoration: underline; }

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

    .word-table-wrap { max-width: 680px; margin: 0 auto; }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: var(--shadow);
    }

    thead th {
      padding: .6rem 1rem;
      text-align: left;
      font-size: .78rem;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      background: var(--bg);
    }

    tbody tr { border-bottom: 1px solid var(--border); transition: background .12s; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: var(--hover); }

    td { padding: .55rem 1rem; vertical-align: middle; }

    .col-def a { color: var(--text); text-decoration: none; font-size: .95rem; }
    .col-def a:hover { color: var(--accent); }

    .col-word a { color: var(--accent); text-decoration: none; font-weight: 600; font-size: 1rem; }
    .col-word a:hover { text-decoration: underline; }

    .col-level { width: 4.5rem; }

    .badge {
      display: inline-block;
      padding: .15em .5em;
      border-radius: 4px;
      font-size: .75rem;
      font-weight: 600;
      letter-spacing: .03em;
    }

    .level-n5 { background: #a6e3a1; color: #1e1e2e; }
    .level-n4 { background: #94e2d5; color: #1e1e2e; }
    .level-n3 { background: #89b4fa; color: #1e1e2e; }
    .level-n2 { background: #cba6f7; color: #1e1e2e; }
    .level-n1 { background: #f38ba8; color: #1e1e2e; }
    .level-unknown { background: var(--border); color: var(--muted); }

    [data-theme="light"] .level-n5 { background: #2d7a27; color: #fff; }
    [data-theme="light"] .level-n4 { background: #1a7a6e; color: #fff; }
    [data-theme="light"] .level-n3 { background: #3b5fc0; color: #fff; }
    [data-theme="light"] .level-n2 { background: #7c3aed; color: #fff; }
    [data-theme="light"] .level-n1 { background: #c0392b; color: #fff; }

    .empty { text-align: center; color: var(--muted); padding: 3rem 0; }
    .site-footer { text-align: center; margin-top: 3rem; color: var(--muted); font-size: .8rem; }

    @media (max-width: 480px) {
      td { padding: .45rem .65rem; }
      .col-level { width: 3.5rem; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <h1 class="site-title">言葉の世界</h1>
    <p class="site-subtitle">${rows.length} word${rows.length !== 1 ? 's' : ''}</p>
    <nav class="nav-links">
      <a href="index.html">Daily</a>
      <a href="manual.html">Custom</a>
      <a href="words.html" class="active">All Words</a>
    </nav>
    <button class="theme-toggle" id="themeToggle" aria-label="Toggle light/dark mode">☀ Light</button>
  </header>

  <div class="word-table-wrap">
    <table>
      <thead>
        <tr>
          <th>English</th>
          <th>Japanese</th>
          <th>Level</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
        ${empty}
      </tbody>
    </table>
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

export function buildMasterWordsIndex(outputDir: string): void {
  const autoEntries   = loadManifest(outputDir, 'auto');
  const manualEntries = loadManifest(outputDir, 'manual');

  const seen = new Set<string>();
  const rows: WordRow[] = [];

  for (const entry of [...autoEntries, ...manualEntries]) {
    for (const w of entry.words) {
      const mw = typeof w === 'string' ? { word: w as string, definition: '', jlptLevel: '' } : w;
      if (!seen.has(mw.word)) {
        seen.add(mw.word);
        rows.push({
          word: mw.word,
          definition: mw.definition ?? '',
          jlptLevel: mw.jlptLevel ?? '',
          file: entry.file,
        });
      }
    }
  }

  rows.sort((a, b) => {
    const da = a.definition.toLowerCase();
    const db = b.definition.toLowerCase();
    if (da && db) return da.localeCompare(db);
    if (da) return -1;
    if (db) return 1;
    return a.word.localeCompare(b.word);
  });

  const html = buildWordsPage(rows);
  const indexPath = resolveOutputPath(outputDir, 'words.html');
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`[output] Words index → ${indexPath} (${rows.length} word${rows.length !== 1 ? 's' : ''})`);
}

// ── Public API ────────────────────────────────────────────

export function writeIndexOutput(
  records: WordRecord[],
  date: string,
  outputDir: string,
  mode: RunMode = 'auto'
): void {
  const entry: ManifestEntry = {
    date,
    wordCount: records.length,
    words: records.map(r => ({ word: r.word, definition: r.definition, jlptLevel: r.jlptLevel })),
    file: `digest-${date}.html`,
  };

  const entries = upsertManifest(outputDir, mode, entry);
  const html = buildIndexPage(entries, mode);

  const indexPath = resolveOutputPath(outputDir, INDEX_FILES[mode]);
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`[output] ${mode === 'manual' ? 'Manual index' : 'Index'} → ${indexPath}`);

  buildMasterWordsIndex(outputDir);
}

/**
 * Rebuild index.html, manual.html, and words.html from existing manifests + digest files on disk.
 */
export function rebuildIndexOutput(outputDir: string): void {
  const resolvedDir = path.resolve(process.cwd(), outputDir);

  for (const mode of ['auto', 'manual'] as RunMode[]) {
    const entries = loadManifest(outputDir, mode);
    const known = new Set(entries.map(e => e.date));

    if (mode === 'auto') {
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
    }

    entries.sort((a, b) => b.date.localeCompare(a.date));
    saveManifest(outputDir, mode, entries);

    const html = buildIndexPage(entries, mode);
    const indexPath = resolveOutputPath(outputDir, INDEX_FILES[mode]);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log(`[output] ${INDEX_FILES[mode]} rebuilt (${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'})`);
  }

  buildMasterWordsIndex(outputDir);
}
