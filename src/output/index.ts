import fs from 'fs';
import path from 'path';
import type { WordRecord } from '../types.js';
import { resolveOutputPath } from '../config.js';
import { esc, asDate, longDate, shortDate, pageHead, BASE_CSS, siteHeader, siteFooter, hasCustomRuns } from './theme.js';
import type { NavPage } from './theme.js';

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

// ── Shared bits ───────────────────────────────────────────

const pageId = (e: ManifestEntry) => e.file.match(/^digest-(.+)\.html$/)?.[1] ?? e.date;
const asWord = (w: ManifestWord | string): ManifestWord =>
  typeof w === 'string' ? { word: w, definition: '', jlptLevel: '' } : w;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function listPage(title: string, current: NavPage, showCustom: boolean, css: string, body: string, script = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${pageHead(title)}
<style>
  ${BASE_CSS}
  main { padding-top: 2.25rem; }
  .page-title { font-size: 1.6rem; font-weight: 800; line-height: 1.2; }
  .lede { color: var(--sub); margin-top: .35rem; }
  .empty { margin-top: 2rem; padding: 1.25rem 1.4rem; border: 1.5px dashed var(--line-strong); border-radius: 10px; color: var(--sub); max-width: 34rem; }
  .empty code { font-size: .9em; color: var(--ink); background: var(--surface); padding: .1em .35em; border-radius: 4px; }
  ${css}
</style>
</head>
<body>
<div class="wrap">
  ${siteHeader(current, showCustom)}
  <main>
${body}
  </main>
  ${siteFooter('言葉の世界, a few Japanese words a day from real news and reading sites.')}
</div>
${script ? `<script>\n(function () {\n${script}\n})();\n</script>` : ''}
</body>
</html>`;
}

// ── Days (index.html): the newest day, then a calendar ────

const WEEKDAYS: Array<[string, string]> = [
  ['日', 'Sunday'], ['月', 'Monday'], ['火', 'Tuesday'], ['水', 'Wednesday'], ['木', 'Thursday'], ['金', 'Friday'], ['土', 'Saturday'],
];

function monthTable(year: number, month: number, byDay: Map<string, ManifestEntry[]>, newestId: string): string {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: string[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<td class="pad"></td>');
  for (let d = 1; d <= days; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const runs = byDay.get(iso) ?? [];
    if (!runs.length) { cells.push(`<td class="${iso > newestId.slice(0, 10) ? 'future' : 'none'}"><span class="d">${d}</span></td>`); continue; }
    const [main, ...more] = runs;
    const words = main.words.map(asWord);
    const label = `${longDate(iso)}: ${words.map(w => `${w.word}${w.definition ? `, ${w.definition}` : ''}`).join('; ')}`;
    cells.push(`<td class="has${runs.some(r => pageId(r) === newestId) ? ' newest' : ''}">
          <a href="${esc(main.file)}" aria-label="${esc(label)}" title="${esc(words.map(w => `${w.word}  ${w.definition}`).join('\n'))}">
            <span class="d">${d}</span>
            <span class="ws" lang="ja">${words.map(w => `<span>${esc(w.word)}</span>`).join('')}</span>
            <span class="dots" aria-hidden="true">${words.map(() => '<i></i>').join('')}</span>
          </a>${more.map((r, k) => `<a class="more" href="${esc(r.file)}">run ${k + 2}</a>`).join('')}
        </td>`);
  }
  while (cells.length % 7) cells.push('<td class="pad"></td>');
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);

  const inMonth = [...byDay.entries()].filter(([k]) => k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));
  const wordTotal = inMonth.reduce((n, [, rs]) => n + rs.reduce((m, r) => m + r.words.length, 0), 0);
  const name = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `
    <section class="month" aria-labelledby="m-${year}-${month + 1}">
      <h2 id="m-${year}-${month + 1}">${name} <span class="m-count">${plural(wordTotal, 'word')}</span></h2>
      <table>
        <thead><tr>${WEEKDAYS.map(([j, en]) => `<th scope="col"><abbr lang="ja" title="${en}">${j}</abbr></th>`).join('')}</tr></thead>
        <tbody>${rows.join('\n')}</tbody>
      </table>
    </section>`;
}

function buildDaysPage(entries: ManifestEntry[], showCustom: boolean): string {
  const sorted = [...entries].sort((a, b) => pageId(b).localeCompare(pageId(a)));
  if (!sorted.length) {
    return listPage('言葉の世界', 'days', showCustom, '', `
    <h1 class="page-title">No days yet</h1>
    <p class="empty">The first day's words appear here after the pipeline runs. Start it with <code>npm start</code>.</p>`);
  }

  const newest = sorted[0];
  const newestWords = newest.words.map(asWord);
  const oldest = sorted[sorted.length - 1];
  const totalWords = new Set(sorted.flatMap(e => e.words.map(w => asWord(w).word))).size;
  const dayCount = new Set(sorted.map(e => e.date.slice(0, 10))).size;

  const byDay = new Map<string, ManifestEntry[]>();
  for (const e of [...sorted].reverse()) {
    const k = e.date.slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const months: string[] = [];
  const start = asDate(oldest.date), end = asDate(newest.date);
  for (let y = end.getFullYear(), m = end.getMonth(); y > start.getFullYear() || (y === start.getFullYear() && m >= start.getMonth()); m--) {
    if (m < 0) { m = 11; y--; }
    months.push(monthTable(y, m, byDay, pageId(newest)));
  }

  const css = `
  .latest { padding-bottom: 2.5rem; border-bottom: 1px solid var(--line); }
  .latest-when { color: var(--sub); font-size: 1.15rem; font-weight: 500; }
  .latest-when strong { color: var(--ink); }
  .latest-words { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 1.25rem 2.5rem; margin: 1.25rem 0 1.75rem; }
  .latest-words a { display: block; text-decoration: none; }
  .latest-words .w { display: block; font-size: clamp(2.6rem, 11vw, 4rem); font-weight: 800; line-height: 1.1; }
  .latest-words .m { display: block; color: var(--sub); font-size: .9rem; max-width: 14rem; margin-top: .2rem; }
  .latest-words a:hover .w { color: var(--signal); }
  .start { display: inline-flex; align-items: center; min-height: 3rem; padding: 0 1.4rem; border-radius: 10px; background: var(--signal); color: var(--ground);
    font-weight: 700; text-decoration: none; }
  .start:hover { box-shadow: 0 0 0 2px var(--ink); }
  .tally { color: var(--muted); font-size: .88rem; margin-top: 1.25rem; }

  .month { margin-top: 2.5rem; }
  .month h2 { font-size: 1.15rem; font-weight: 800; margin-bottom: .75rem; }
  .m-count { font-size: .85rem; font-weight: 400; color: var(--muted); margin-left: .5rem; }
  .month table { width: 100%; border-collapse: separate; border-spacing: 4px; table-layout: fixed; margin: 0 -4px; width: calc(100% + 8px); }
  .month th { font-size: .8rem; font-weight: 500; color: var(--muted); padding-bottom: .15rem; }
  .month abbr { text-decoration: none; }
  .month td { vertical-align: top; height: 6.25rem; border-radius: 8px; font-size: .8rem; }
  .month td.none { background: var(--surface); }
  .month td.future .d { display: block; padding: .4rem .5rem; color: var(--line-strong); }
  .month td.none .d { display: block; padding: .4rem .5rem; color: var(--muted); }
  .month td.has { background: var(--raised); }
  .month td.has a:first-child { display: flex; flex-direction: column; height: 100%; padding: .4rem .5rem; text-decoration: none; border-radius: 8px; }
  .month td.has a:first-child:hover { box-shadow: inset 0 0 0 1.5px var(--signal); }
  .month td.newest { box-shadow: inset 0 0 0 2px var(--signal); }
  .month .d { font-weight: 700; }
  .month .ws { display: flex; flex-direction: column; margin-top: .2rem; font-size: .92rem; font-weight: 600; line-height: 1.35; }
  .month .ws span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .month .dots { display: none; gap: 3px; margin-top: .3rem; flex-wrap: wrap; }
  .month .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--signal); }
  .month .more { display: block; padding: 0 .5rem .3rem; font-size: .72rem; color: var(--sub); }
  @media (max-width: 640px) {
    .month table { border-spacing: 3px; margin: 0 -3px; width: calc(100% + 6px); }
    .month td { height: 3.4rem; }
    .month td.has a:first-child, .month td.none .d, .month td.future .d { padding: .3rem .35rem; }
    .month .ws { display: none; }
    .month .dots { display: flex; }
  }`;

  const body = `
    <section class="latest" aria-labelledby="latest-h">
      <h1 class="latest-when" id="latest-h">Newest words, <strong>${esc(longDate(newest.date))}</strong></h1>
      <ul class="latest-words">
        ${newestWords.map((w, i) => `<li><a href="${esc(newest.file)}#w${i + 1}"><span class="w" lang="ja">${esc(w.word)}</span><span class="m">${esc(w.definition)}</span></a></li>`).join('\n        ')}
      </ul>
      <a class="start" href="${esc(newest.file)}">Study these words</a>
      <p class="tally">${plural(totalWords, 'word')} over ${plural(dayCount, 'day')} since ${esc(longDate(oldest.date))}.</p>
    </section>
    ${months.join('\n')}`;

  return listPage('言葉の世界', 'days', showCustom, css, body);
}

// ── Custom runs (manual.html) ─────────────────────────────

function buildCustomPage(entries: ManifestEntry[], showCustom: boolean): string {
  const sorted = [...entries].sort((a, b) => pageId(b).localeCompare(pageId(a)));
  const rows = sorted.map(e => `
      <li>
        <a href="${esc(e.file)}">
          <span class="when">${esc(longDate(e.date))}</span>
          <span class="ws">${e.words.map(asWord).map(w => `<span><b lang="ja">${esc(w.word)}</b> ${esc(w.definition)}</span>`).join('')}</span>
        </a>
      </li>`).join('');
  const css = `
  .runs { list-style: none; padding: 0; margin-top: 1.75rem; border-top: 1px solid var(--line); }
  .runs a { display: grid; grid-template-columns: 15rem 1fr; gap: .25rem 1.5rem; padding: 1rem .25rem; border-bottom: 1px solid var(--line); text-decoration: none; }
  .runs a:hover { background: var(--surface); }
  .when { color: var(--sub); font-size: .9rem; }
  .ws { display: flex; flex-direction: column; gap: .2rem; }
  .ws b { font-size: 1.15rem; margin-right: .5rem; }
  @media (max-width: 640px) { .runs a { grid-template-columns: 1fr; } }`;
  const body = `
    <h1 class="page-title">Custom runs</h1>
    <p class="lede">Words picked on request rather than by the daily run.</p>
    ${sorted.length
      ? `<ol class="runs">${rows}\n    </ol>`
      : `<p class="empty">No custom runs yet. To study a word you choose, run <code>npm start -- --word 食べる</code>, or pick from one source with <code>--source "NHK News"</code>.</p>`}`;
  return listPage('言葉の世界 Custom runs', 'custom', showCustom, css, body);
}

function buildIndexPage(entries: ManifestEntry[], mode: RunMode, showCustom: boolean): string {
  return mode === 'manual' ? buildCustomPage(entries, showCustom) : buildDaysPage(entries, showCustom);
}

// ── All words (words.html): search, filter, sort, self-test ──

interface WordRow {
  word: string;
  reading: string;
  definition: string;
  jlptLevel: string;
  date: string;
  href: string;
}

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

function buildWordsPage(rows: WordRow[], dayCount: number, showCustom: boolean): string {
  const items = rows.map(r => {
    const level = LEVELS.includes(r.jlptLevel) ? r.jlptLevel : '';
    return `
      <li data-date="${esc(r.date)}" data-level="${level || 'other'}" data-en="${esc(r.definition.toLowerCase())}" data-kana="${esc(r.reading)}" data-q="${esc(`${r.word} ${r.reading} ${r.definition}`.toLowerCase())}">
        <a class="w" href="${esc(r.href)}"><b lang="ja">${esc(r.word)}</b>${r.reading && r.reading !== r.word ? `<span lang="ja">${esc(r.reading)}</span>` : ''}</a>
        <span class="m">${esc(r.definition) || '<i>No meaning saved</i>'}</span>
        <button class="m-cover" type="button">Show meaning</button>
        <span class="lv">${level || ''}</span>
        <span class="dt">${esc(shortDate(r.date))}</span>
      </li>`;
  }).join('');

  const css = `
  .tools { position: sticky; top: 0; z-index: 20; margin: 1.5rem -1.25rem 0; padding: .75rem 1.25rem; display: flex; flex-wrap: wrap; gap: .6rem 1rem; align-items: center;
    background: color-mix(in oklab, var(--ground) 92%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  .search { flex: 1 1 100%; min-width: 0; min-height: 2.75rem; padding: 0 .9rem; border-radius: 10px; border: 1.5px solid var(--line-strong); background: var(--surface); font-size: 1rem; }
  .search:focus { border-color: var(--signal); outline: none; }
  .seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
  .seg button { background: none; border: 0; padding: .4rem .65rem; min-height: 2.5rem; cursor: pointer; color: var(--sub); font-size: .88rem; }
  .seg button + button { border-left: 1px solid var(--line-strong); }
  .seg button[aria-pressed="true"] { background: var(--ink); color: var(--ground); }
  .seg button:hover:not([aria-pressed="true"]) { color: var(--ink); background: var(--surface); }
  .sort { min-height: 2.5rem; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--ground); padding: 0 .5rem; font-size: .88rem; }
  .chip { min-height: 2.5rem; padding: 0 .9rem; border-radius: 999px; border: 1px solid var(--line-strong); background: none; cursor: pointer; font-size: .88rem; }
  .chip[aria-pressed="true"] { background: var(--ink); color: var(--ground); border-color: var(--ink); }
  .status { color: var(--muted); font-size: .85rem; margin: .9rem 0 .25rem; }

  .words { list-style: none; padding: 0; }
  .words li { display: grid; grid-template-columns: minmax(8rem, 12rem) 1fr 2.2rem 4.5rem; gap: .25rem 1rem; align-items: baseline;
    padding: .75rem 0; border-bottom: 1px solid var(--line); }
  .words li[hidden] { display: none; }
  .words .w { text-decoration: none; display: flex; flex-direction: column; }
  .words .w b { font-size: 1.35rem; font-weight: 700; line-height: 1.3; }
  .words .w span { font-size: .85rem; color: var(--sub); }
  .words .w:hover b { color: var(--signal); }
  .words .m i { color: var(--muted); }
  .words .lv { font-weight: 800; font-size: .85rem; }
  .words .dt { color: var(--muted); font-size: .8rem; text-align: right; white-space: nowrap; }
  .m-cover { display: none; justify-self: start; font-size: .82rem; color: var(--sub); background: var(--surface); border: 1.5px dashed var(--line-strong);
    border-radius: 8px; padding: .3rem .8rem; min-height: 2.25rem; cursor: pointer; }
  .m-cover:hover { border-color: var(--signal); color: var(--ink); }
  .hide-en .words li:not(.shown) .m { display: none; }
  .hide-en .words li:not(.shown) .m-cover { display: block; }
  .no-match { margin-top: 1.5rem; }
  .no-match[hidden] { display: none; }
  .linkish { background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
  @media (max-width: 640px) {
    .words li { grid-template-columns: 1fr auto; }
    .words .m, .words .m-cover { grid-column: 1 / -1; grid-row: 2; }
    .words .lv { grid-column: 2; grid-row: 1; text-align: right; }
    .words .dt { display: none; }
    .tools { gap: .5rem; }
    .search { flex-basis: 100%; }
  }`;

  const body = `
    <h1 class="page-title">All words</h1>
    <p class="lede">Every word so far: ${plural(rows.length, 'word')} from ${plural(dayCount, 'day')}. Select a word to open it on its day.</p>
    <div class="tools" role="search">
      <input class="search" id="q" type="search" placeholder="Search kanji, kana or English" aria-label="Search words" autocomplete="off">
      <div class="seg" role="group" aria-label="JLPT level" id="levels">
        <button type="button" data-level="" aria-pressed="true">All</button>${LEVELS.map(l => `<button type="button" data-level="${l}" aria-pressed="false">${l}</button>`).join('')}
      </div>
      <select class="sort" id="sort" aria-label="Sort order">
        <option value="new">Newest first</option>
        <option value="old">Oldest first</option>
        <option value="en">English A to Z</option>
        <option value="kana">Reading あ to ん</option>
      </select>
      <button class="chip" type="button" id="hide" aria-pressed="false">Hide English</button>
    </div>
    <p class="status" id="status" aria-live="polite"></p>
    <ol class="words" id="words">${items}
    </ol>
    <p class="empty no-match" id="none" hidden>No words match. Try the kana spelling, a shorter English word, or <button type="button" class="linkish" id="clear">clear the search and level</button>.</p>`;

  const script = `
  var list = document.getElementById('words'), q = document.getElementById('q'), sort = document.getElementById('sort');
  var status = document.getElementById('status'), none = document.getElementById('none'), hide = document.getElementById('hide');
  var items = Array.prototype.slice.call(list.children), level = '';
  // Katakana to hiragana, so "カメラ" and "かめら" find the same words.
  function norm(s) { return s.toLowerCase().trim().replace(/[\\u30a1-\\u30f6]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }); }
  items.forEach(function (li) { li.dataset.nq = norm(li.dataset.q); });
  var collator = new Intl.Collator('ja');
  var cmp = {
    'new': function (a, b) { return b.dataset.date.localeCompare(a.dataset.date); },
    old: function (a, b) { return a.dataset.date.localeCompare(b.dataset.date); },
    en: function (a, b) { return a.dataset.en.localeCompare(b.dataset.en); },
    kana: function (a, b) { return collator.compare(a.dataset.kana, b.dataset.kana); }
  };
  function update() {
    var term = norm(q.value), shown = 0;
    items.forEach(function (li) {
      var ok = (!term || li.dataset.nq.indexOf(term) >= 0) && (!level || li.dataset.level === level);
      li.hidden = !ok; if (ok) shown++;
    });
    status.textContent = shown === items.length ? 'Showing all ' + shown + ' words' : 'Showing ' + shown + ' of ' + items.length + ' words';
    none.hidden = shown > 0;
  }
  function resort() { items.slice().sort(cmp[sort.value]).forEach(function (li) { list.appendChild(li); }); }
  q.addEventListener('input', update);
  sort.addEventListener('change', resort);
  document.getElementById('levels').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    level = b.dataset.level;
    this.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    update();
  });
  document.getElementById('clear').addEventListener('click', function () {
    q.value = ''; document.querySelector('#levels [data-level=""]').click(); q.focus();
  });
  var hidden = false;
  try { hidden = localStorage.getItem('kotoba-words-hide-en') === 'on'; } catch (e) {}
  function showHide() {
    document.documentElement.classList.toggle('hide-en', hidden);
    hide.setAttribute('aria-pressed', String(hidden));
    items.forEach(function (li) { li.classList.remove('shown'); });
  }
  hide.addEventListener('click', function () {
    hidden = !hidden; try { localStorage.setItem('kotoba-words-hide-en', hidden ? 'on' : 'off'); } catch (e) {}
    showHide();
  });
  list.addEventListener('click', function (e) {
    var c = e.target.closest('.m-cover'); if (!c) return;
    var li = c.closest('li'); li.classList.add('shown');
  });
  showHide(); update();`;

  return listPage('言葉の世界 All words', 'words', showCustom, css, body, script);
}

function loadRecords(jsonDir: string, id: string): WordRecord[] | null {
  try {
    const p = path.resolve(process.cwd(), jsonDir, `words-${id}.json`);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (data.fullRecords ?? data) as WordRecord[];
  } catch {
    return null;
  }
}

export function buildMasterWordsIndex(outputDir: string, jsonDir = 'output/data'): void {
  const autoEntries   = loadManifest(outputDir, 'auto');
  const manualEntries = loadManifest(outputDir, 'manual');

  const seen = new Set<string>();
  const rows: WordRow[] = [];

  for (const entry of [...autoEntries, ...manualEntries]) {
    const id = pageId(entry);
    const records = loadRecords(jsonDir, id);
    entry.words.map(asWord).forEach((w, i) => {
      if (seen.has(w.word)) return;
      seen.add(w.word);
      const rec = records?.find(r => r.word === w.word);
      rows.push({
        word: w.word,
        reading: rec?.reading ?? '',
        definition: w.definition || rec?.definition || '',
        jlptLevel: w.jlptLevel || rec?.jlptLevel || '',
        date: id,
        href: `${entry.file}#w${i + 1}`,
      });
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  const dayCount = new Set([...autoEntries, ...manualEntries].map(e => e.date.slice(0, 10))).size;

  const html = buildWordsPage(rows, dayCount, manualEntries.length > 0);
  const indexPath = resolveOutputPath(outputDir, 'words.html');
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`[output] Words index → ${indexPath} (${rows.length} word${rows.length !== 1 ? 's' : ''})`);
}

// ── Public API ────────────────────────────────────────────

export function writeIndexOutput(
  records: WordRecord[],
  date: string,
  outputDir: string,
  mode: RunMode = 'auto',
  jsonDir = 'output/data'
): void {
  const entry: ManifestEntry = {
    date,
    wordCount: records.length,
    words: records.map(r => ({ word: r.word, definition: r.definition, jlptLevel: r.jlptLevel })),
    file: `digest-${date}.html`,
  };

  const entries = upsertManifest(outputDir, mode, entry);
  const html = buildIndexPage(entries, mode, hasCustomRuns(outputDir));

  const indexPath = resolveOutputPath(outputDir, INDEX_FILES[mode]);
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`[output] ${mode === 'manual' ? 'Manual index' : 'Index'} → ${indexPath}`);

  buildMasterWordsIndex(outputDir, jsonDir);
}

/**
 * Rebuild index.html, manual.html, and words.html from existing manifests + digest files on disk.
 */
function loadWordsFromJson(jsonOutputDir: string, date: string): Pick<ManifestEntry, 'wordCount' | 'words'> {
  try {
    const jsonPath = path.resolve(process.cwd(), jsonOutputDir, `words-${date}.json`);
    if (!fs.existsSync(jsonPath)) return { wordCount: 0, words: [] };
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const records: WordRecord[] = data.fullRecords ?? data;
    return {
      wordCount: records.length,
      words: records.map(r => ({ word: r.word, definition: r.definition, jlptLevel: r.jlptLevel })),
    };
  } catch {
    return { wordCount: 0, words: [] };
  }
}

export function rebuildIndexOutput(outputDir: string, jsonOutputDir: string): void {
  const resolvedDir = path.resolve(process.cwd(), outputDir);

  for (const mode of ['auto', 'manual'] as RunMode[]) {
    // Remove entries whose digest file no longer exists on disk
    let entries = loadManifest(outputDir, mode)
      .filter(e => fs.existsSync(path.join(resolvedDir, e.file)));
    const known = new Set(entries.map(e => e.date));

    if (mode === 'auto') {
      try {
        for (const f of fs.readdirSync(resolvedDir)) {
          const m = f.match(/^digest-(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.html$/);
          if (m && !known.has(m[1])) {
            entries.push({ date: m[1], file: f, ...loadWordsFromJson(jsonOutputDir, m[1]) });
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

    const html = buildIndexPage(entries, mode, hasCustomRuns(outputDir));
    const indexPath = resolveOutputPath(outputDir, INDEX_FILES[mode]);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log(`[output] ${INDEX_FILES[mode]} rebuilt (${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'})`);
  }

  buildMasterWordsIndex(outputDir, jsonOutputDir);
}
