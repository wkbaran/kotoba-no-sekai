import fs from 'fs';
import path from 'path';
import { resolveOutputPath } from '../config.js';
import { ATTRIBUTION_HTML } from './attribution.js';

// Shared look for every published page: fonts, the palette switcher, colour
// tokens, the site header and footer.
//
// Colour comes from three inputs (--p-ground, --p-ink, --p-signal) set by the
// palette switcher; everything else is mixed from them, and light mode swaps
// ground and ink. The presets are combinations from Wada Sanzo's "A
// Dictionary of Color Combinations". The signal colour is spent only on what
// wants attention: the target word, the current place, the next action.

export const WADA_PRESETS = [
  { no: 166, names: ['Deep slate green', 'Naples yellow', 'Grenadine pink'], colors: ['#112f2c', '#fbe6a0', '#f48067'] },
  { no: 151, names: ["Vandar Poel's blue", 'Sulphur yellow', 'Yellow orange'], colors: ['#064f6e', '#f5ecc2', '#f99d1b'] },
  { no: 190, names: ['Black', 'Ivory buff', 'English red'], colors: ['#111314', '#ebd3a2', '#d96629'] },
  { no: 268, names: ['Deep slate olive', 'Nile blue', 'Raw sienna'], colors: ['#253122', '#bce4e5', '#bb7125'] },
  { no: 126, names: ['Deep Lyons blue', 'Ivory buff', 'Yellow ocher'], colors: ['#1c4286', '#ebd3a2', '#e2b540'] },
  { no: 276, names: ['Black', 'Seashell pink', 'Eosine pink'], colors: ['#111314', '#fdd4bd', '#f37f94'] },
];
const DEFAULT_PRESET = 166;

export function esc(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Page ids are YYYY-MM-DD, or YYYY-MM-DD-N for a later run the same day. */
export function asDate(id: string): Date {
  return new Date(id.slice(0, 10) + 'T12:00:00');
}
export const longDate = (id: string) =>
  asDate(id).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const shortDate = (id: string) =>
  asDate(id).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + (id.length > 10 ? `, run ${id.slice(11)}` : '');

/** True once any custom (--word/--source/--url) run has been published. */
export function hasCustomRuns(outputDir: string): boolean {
  try {
    const p = path.resolve(process.cwd(), outputDir, 'manual-manifest.json');
    return (JSON.parse(fs.readFileSync(p, 'utf8')) as unknown[]).length > 0;
  } catch {
    return false;
  }
}

// Runs in <head> before first paint so the page never flashes another palette.
function paletteScript(): string {
  const defaults = WADA_PRESETS.find(p => p.no === DEFAULT_PRESET)!.colors;
  return `<script>
(() => {
  "use strict";
  const KEY = "kotoba.palette", THEME_KEY = "kotoba-theme";
  const root = document.documentElement;
  const PRESETS = ${JSON.stringify(WADA_PRESETS)};
  const defaults = ${JSON.stringify(defaults)};

  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t ? t === "light" : matchMedia("(prefers-color-scheme: light)").matches) root.setAttribute("data-theme", "light");
  } catch (e) {}

  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (Array.isArray(saved) && saved.length === 3) return saved;
    } catch {}
    return defaults;
  }
  function apply(c) {
    root.style.setProperty("--p-ground", c[0]);
    root.style.setProperty("--p-ink", c[1]);
    root.style.setProperty("--p-signal", c[2]);
  }
  function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} }
  function nameOf(c) {
    const p = PRESETS.find(p => p.colors.join() === c.join());
    return p ? "Combination " + p.no + ": " + p.names.join(", ") : "Your own mix";
  }

  let colors = read();
  apply(colors);

  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    n.append(...children);
    return n;
  }

  function build() {
    const mount = document.getElementById("pal-mount");
    if (!mount) return;
    const name = el("p", { class: "pal-name" });
    const refresh = () => {
      inputs.forEach(({ input }, i) => (input.value = colors[i]));
      name.textContent = nameOf(colors);
      presets.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.c === colors.join())));
    };
    const inputs = ["Background", "Text", "Accent"].map((label, i) => {
      const id = "pal-" + i;
      const input = el("input", { type: "color", id, value: colors[i] });
      input.addEventListener("input", () => {
        colors = colors.map((c, j) => (j === i ? input.value : c));
        apply(colors); save(colors); refresh();
      });
      return { input, row: el("div", { class: "pal-field" }, input, el("label", { for: id, text: label })) };
    });
    const presets = el("div", { class: "pal-presets" }, ...PRESETS.map(p =>
      el("button", {
        type: "button", class: "pal-preset", "data-c": p.colors.join(),
        title: "Combination " + p.no + ": " + p.names.join(", "),
        "aria-label": "Use combination " + p.no + ", " + p.names.join(", "),
        onclick: () => { colors = [...p.colors]; apply(colors); save(colors); refresh(); },
      }, ...p.colors.map(c => el("span", { style: "background:" + c })))
    ));
    const mode = el("button", {
      type: "button", class: "pal-mode",
      onclick: () => {
        const light = root.getAttribute("data-theme") !== "light";
        if (light) root.setAttribute("data-theme", "light"); else root.removeAttribute("data-theme");
        try { localStorage.setItem(THEME_KEY, light ? "light" : "dark"); } catch {}
        mode.textContent = light ? "Switch to dark" : "Switch to light";
      },
    });
    mode.textContent = root.getAttribute("data-theme") === "light" ? "Switch to dark" : "Switch to light";
    const reset = el("button", {
      type: "button", class: "pal-reset", text: "Reset to the default colors",
      onclick: () => { colors = [...defaults]; apply(colors); try { localStorage.removeItem(KEY); } catch {} refresh(); },
    });
    const panel = el("div", { class: "pal-panel", id: "pal-panel", role: "dialog", "aria-label": "Colors", hidden: "" },
      el("p", { class: "pal-heading", text: "Colors" }),
      el("p", { class: "pal-note", text: "Combinations from Wada Sanzo's Dictionary of Color Combinations." }),
      presets, name, mode, ...inputs.map(x => x.row), reset);
    const toggle = el("button", {
      type: "button", class: "pal-toggle", "aria-expanded": "false", "aria-controls": "pal-panel", "aria-label": "Colors",
      onclick: () => { panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden)); },
    }, ...["ground", "ink", "signal"].map(k => el("span", { style: "background:var(--p-" + k + ")" })));
    const box = el("div", { class: "pal" }, panel, toggle);
    const close = () => { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); };
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) { close(); toggle.focus(); } });
    document.addEventListener("pointerdown", e => { if (!panel.hidden && !box.contains(e.target)) close(); });
    mount.append(box);
    refresh();
  }
  document.addEventListener("DOMContentLoaded", build);
})();
</script>`;
}

// Site icon: 言, drawn from rectangles so it needs no font, in the default
// combination (166). The top stroke takes the signal colour.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#112f2c"/>
<g fill="#fbe6a0">
<rect x="10" y="17" width="44" height="6" rx="1.5"/>
<rect x="17" y="27" width="30" height="5" rx="1.5"/>
<rect x="17" y="36" width="30" height="5" rx="1.5"/>
<path fill-rule="evenodd" d="M17 45h30v13H17zM22.5 49.5v4h19v-4z"/>
</g>
<rect x="28.5" y="6" width="7" height="8" rx="2" fill="#f48067"/>
</svg>
`;

/** Writes favicon.svg next to the pages, which link to it from pageHead. */
export function writeFavicon(outputDir: string): void {
  fs.writeFileSync(resolveOutputPath(outputDir, 'favicon.svg'), FAVICON_SVG, 'utf8');
}

/** Everything in <head> before the page's own <style>. */
export function pageHead(title: string): string {
  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=M+PLUS+1:wght@300..900&display=swap" rel="stylesheet">
${paletteScript()}`;
}

export const BASE_CSS = `
  :root { --ground: var(--p-ground); --ink: var(--p-ink); --signal: var(--p-signal); color-scheme: dark; }
  :root[data-theme="light"] {
    --ground: var(--p-ink); --ink: var(--p-ground);
    --signal: color-mix(in oklab, var(--p-signal) 62%, var(--p-ground)); color-scheme: light;
  }
  :root {
    --surface: color-mix(in oklab, var(--ink) 5%, var(--ground));
    --raised: color-mix(in oklab, var(--ink) 9%, var(--ground));
    --line: color-mix(in oklab, var(--ink) 15%, var(--ground));
    --line-strong: color-mix(in oklab, var(--ink) 28%, var(--ground));
    --muted: color-mix(in oklab, var(--ink) 55%, var(--ground));
    --sub: color-mix(in oklab, var(--ink) 74%, var(--ground));
    --wash: color-mix(in oklab, var(--signal) 18%, var(--ground));
    --shadow: 0 18px 48px color-mix(in oklab, black 40%, transparent);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { font-size: 17px; -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: 'M PLUS 1', system-ui, sans-serif;
    line-height: 1.6; -webkit-font-smoothing: antialiased; }
  :focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
  a { color: inherit; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
  a:hover { text-decoration-color: var(--signal); }
  button, input, select { font: inherit; color: inherit; }
  h1, h2, h3, p, ol, ul { margin: 0; }
  .wrap { max-width: 50rem; margin: 0 auto; padding: 0 1.25rem; }

  /* ── Site header ── */
  .top { display: flex; align-items: center; gap: 1.25rem; padding-top: 1rem; }
  .brand { font-weight: 800; font-size: 1.05rem; text-decoration: none; margin-right: auto; white-space: nowrap; }
  .nav { display: flex; gap: 1.1rem; font-size: .9rem; }
  .nav a { text-decoration: none; color: var(--sub); padding: .4rem 0; white-space: nowrap; }
  .nav a:hover { color: var(--ink); }
  .nav a[aria-current] { color: var(--ink); box-shadow: inset 0 -2px 0 var(--signal); }

  /* ── Footer ── */
  .foot { color: var(--muted); font-size: .78rem; line-height: 1.6; margin-top: 3rem; padding-bottom: 2rem; max-width: 40rem; }
  .attribution { margin: .4rem 0 0; }
  .attribution a { color: inherit; }

  /* ── Palette control ── */
  .pal { position: relative; }
  .pal-toggle { display: flex; padding: 4px 6px; min-height: 2.25rem; align-items: center; border-radius: 999px;
    background: var(--raised); border: 1px solid var(--line); cursor: pointer; }
  .pal-toggle:hover { border-color: var(--line-strong); }
  .pal-toggle span, .pal-preset span { width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 0 1px var(--line-strong); }
  .pal-toggle span + span, .pal-preset span + span { margin-left: -5px; }
  .pal-panel { position: absolute; right: 0; top: calc(100% + 8px); width: 16.5rem; padding: 1rem; display: grid; gap: .6rem; z-index: 40;
    background: var(--raised); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow);
    font-size: .85rem; line-height: 1.4; text-align: left; }
  .pal-panel[hidden] { display: none; }
  .pal-panel p { margin: 0; }
  .pal-heading { font-weight: 700; font-size: 1rem; }
  .pal-note, .pal-name { color: var(--sub); font-size: .78rem; }
  .pal-presets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .pal-preset { display: flex; justify-content: center; padding: 8px 4px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
  .pal-preset[aria-pressed="true"] { border-color: var(--signal); box-shadow: inset 0 0 0 1px var(--signal); }
  .pal-field { display: flex; align-items: center; gap: .6rem; }
  .pal-field input { width: 2.2rem; height: 1.6rem; padding: 0; border: 1px solid var(--line); border-radius: 4px; background: none; }
  .pal-mode, .pal-reset { font-size: .8rem; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: .45rem .6rem; cursor: pointer; text-align: left; }
  .pal-mode:hover, .pal-reset:hover { border-color: var(--line-strong); }

  @media (max-width: 640px) {
    html { font-size: 16px; }
    .top { gap: .9rem; }
    .nav { gap: .8rem; font-size: .85rem; }
  }
  @media (max-width: 360px) {
    .brand { font-size: .95rem; }
    .nav { gap: .6rem; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
`;

export type NavPage = 'days' | 'words' | 'custom' | null;

/** Site header. `current` marks the list page being viewed; digest pages pass null. */
export function siteHeader(current: NavPage, showCustom: boolean, base = ''): string {
  const link = (page: NavPage, href: string, label: string) =>
    `<a href="${base}${href}"${current === page ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="top">
    <a class="brand" href="${base}index.html" lang="ja">言葉の世界</a>
    <nav class="nav" aria-label="Site">
      ${link('days', 'index.html', 'Days')}
      ${link('words', 'words.html', 'All words')}
      ${showCustom ? link('custom', 'manual.html', 'Custom') : ''}
    </nav>
    <div id="pal-mount"></div>
  </header>`;
}

export function siteFooter(note: string): string {
  return `<footer class="foot">
    <p>${note}</p>
    ${ATTRIBUTION_HTML}
  </footer>`;
}
