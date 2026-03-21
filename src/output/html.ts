import fs from 'fs';
import type { WordRecord, JlptLevel } from '../types.js';
import { resolveOutputPath } from '../config.js';

const JLPT_COLORS: Record<JlptLevel, { bg: string; fg: string; border: string }> = {
  N5:      { bg: '#e8f5e9', fg: '#2e7d32', border: '#4caf50' },
  N4:      { bg: '#f1f8e9', fg: '#558b2f', border: '#8bc34a' },
  N3:      { bg: '#fff8e1', fg: '#f57f17', border: '#ffc107' },
  N2:      { bg: '#fff3e0', fg: '#e65100', border: '#ff9800' },
  N1:      { bg: '#fce4ec', fg: '#c62828', border: '#ef5350' },
  unknown: { bg: '#f5f5f5', fg: '#616161', border: '#9e9e9e' },
};

function jlptBadge(level: JlptLevel): string {
  const c = JLPT_COLORS[level];
  return `<span class="badge" style="background:${c.bg};color:${c.fg};border-color:${c.border}">${level}</span>`;
}

function domainBadge(domain: string): string {
  return `<span class="badge badge-domain">${domain}</span>`;
}

function renderCard(record: WordRecord): string {
  const color = JLPT_COLORS[record.jlptLevel];
  const examples = record.examples.map(ex => {
    // Wrap the marked sentence in a link to the source
    const linked = ex.markedHtml.replace(
      /<mark>(.*?)<\/mark>/g,
      `<a href="${ex.sourceUrl}" target="_blank" rel="noopener" class="source-link"><mark>$1</mark></a>`
    );
    return `<blockquote class="example">${linked}</blockquote>`;
  }).join('\n');

  const altDefs = record.altDefinitions.length > 0
    ? `<p class="alt-defs"><em>Also:</em> ${record.altDefinitions.slice(0, 3).join('; ')}</p>`
    : '';

  return `
  <article class="word-card" style="border-left-color:${color.border}">
    <div class="card-header">
      <div class="word-main">
        <span class="word-kanji">${record.word}</span>
        <span class="word-reading">【${record.reading}】</span>
      </div>
      <div class="badges">
        ${jlptBadge(record.jlptLevel)}
        ${domainBadge(record.domain)}
      </div>
    </div>
    <p class="pos">${record.pos}</p>
    <p class="definition">${record.definition}</p>
    ${altDefs}
    ${examples}
  </article>`;
}

function buildPage(records: WordRecord[], date: string): string {
  const cards = records.map(renderCard).join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>言葉の世界 — ${date}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --surface:  #ffffff;
      --bg:       #f8f9fa;
      --text:     #212529;
      --muted:    #6c757d;
      --accent:   #5c6bc0;
      --radius:   10px;
      --shadow:   0 2px 8px rgba(0,0,0,.08);
    }

    body {
      font-family: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
      padding: 2rem 1rem;
    }

    .site-header {
      text-align: center;
      margin-bottom: 2.5rem;
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

    .word-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1.25rem;
      max-width: 1100px;
      margin: 0 auto;
    }

    .word-card {
      background: var(--surface);
      border-radius: var(--radius);
      border-left: 4px solid #ccc;
      padding: 1.25rem 1.5rem;
      box-shadow: var(--shadow);
      transition: box-shadow .2s;
    }

    .word-card:hover {
      box-shadow: 0 4px 16px rgba(0,0,0,.12);
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: .75rem;
      margin-bottom: .6rem;
    }

    .word-main {
      display: flex;
      align-items: baseline;
      gap: .4rem;
      flex-wrap: wrap;
    }

    .word-kanji {
      font-size: 1.75rem;
      font-weight: 700;
    }

    .word-reading {
      font-size: 1rem;
      color: var(--muted);
    }

    .badges {
      display: flex;
      gap: .35rem;
      flex-shrink: 0;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .badge {
      display: inline-block;
      font-size: .7rem;
      font-weight: 700;
      padding: .2em .55em;
      border-radius: 4px;
      border: 1px solid currentColor;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .badge-domain {
      background: #e8eaf6;
      color: #3949ab;
      border-color: #7986cb;
    }

    .pos {
      font-size: .8rem;
      color: var(--muted);
      margin-bottom: .3rem;
      font-style: italic;
    }

    .definition {
      font-size: 1.05rem;
      font-weight: 500;
      margin-bottom: .25rem;
    }

    .alt-defs {
      font-size: .85rem;
      color: var(--muted);
      margin-bottom: .5rem;
    }

    .example {
      margin-top: .75rem;
      padding: .6rem 1rem;
      background: var(--bg);
      border-left: 3px solid #dee2e6;
      border-radius: 0 var(--radius) var(--radius) 0;
      font-size: .95rem;
      color: #343a40;
    }

    .example mark {
      background: #fff9c4;
      color: inherit;
      border-radius: 2px;
      padding: 0 2px;
      font-weight: 700;
    }

    .source-link {
      color: inherit;
      text-decoration: none;
    }

    .source-link:hover mark {
      background: #ffe082;
      text-decoration: underline;
    }

    .site-footer {
      text-align: center;
      margin-top: 3rem;
      color: var(--muted);
      font-size: .8rem;
    }
  </style>
</head>
<body>
  <header class="site-header">
    <h1 class="site-title">言葉の世界</h1>
    <p class="site-subtitle">${date} · ${records.length} word${records.length !== 1 ? 's' : ''}</p>
  </header>

  <div class="word-grid">
    ${cards}
  </div>

  <footer class="site-footer">
    <p>Generated by <strong>Kotoba no Sekai</strong> on ${date}</p>
  </footer>
</body>
</html>`;
}

export function writeHtmlOutput(
  records: WordRecord[],
  date: string,
  outputDir: string
): string {
  const html = buildPage(records, date);
  const filename = `digest-${date}.html`;
  const outPath = resolveOutputPath(outputDir, filename);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`[output] HTML → ${outPath}`);
  return outPath;
}
