import fs from 'fs';
import path from 'path';
import type { WordRecord } from '../types.js';
import { resolveOutputPath } from '../config.js';
import { conjugate, findForms } from '../conjugation.js';
import { esc, longDate, shortDate, pageHead, BASE_CSS, siteHeader, siteFooter, hasCustomRuns } from './theme.js';

// Daily digest page: one word at a time, reading and meaning hidden until
// asked for (active recall), with the example sentences underneath.

type RunMode = 'auto' | 'manual';

// Small kana get a smaller circle in the hidden-reading hint.
const SMALL_KANA = new Set([...'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ']);

// Marks the "next day" control so it can be swapped for a link once the
// following day's digest exists.
const NEXT_START = '<!--next-day-->';
const NEXT_END = '<!--/next-day-->';


function sourceName(url: string): string {
  let host: string;
  try { host = new URL(url).hostname.replace(/^www\d*\./, ''); } catch { return 'the source'; }
  if (host.endsWith('asahi.com')) return 'Asahi Shimbun';
  if (host.endsWith('nhk.or.jp')) return 'NHK';
  if (host.endsWith('watanoc.com')) return 'Watanoc';
  return host;
}

const posLabel = (pos: string) => pos.replace(/\s*\(.*\)$/, '').toLowerCase();


function audioTags(sets: Array<[string, string | undefined, string, number?]>, base: string): string {
  return sets
    .filter(([, src]) => !!src)
    .map(([speed, src, cls, idx]) =>
      `<audio class="${cls}" data-speed="${speed}"${idx != null ? ` data-index="${idx}"` : ''} src="${base}${src}" preload="none"></audio>`)
    .join('');
}

function readingHint(reading: string): string {
  const chars = [...reading];
  const small = chars.filter(c => SMALL_KANA.has(c)).length;
  const dots = chars.map(c => SMALL_KANA.has(c) ? '<i class="sm"></i>' : '<i></i>').join('');
  const note = `${chars.length} kana${small ? `, ${small} small` : ''}`;
  return `<span class="dots" aria-hidden="true">${dots}</span><span class="dots-note">${note}</span>`;
}

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';

/** How the word conjugates, with the forms used in the example sentences marked. */
function renderForms(record: WordRecord): string {
  const conj = conjugate(record.word, record.pos);
  if (!conj) return '';
  const matches = findForms(conj, record.examples.map(e => e.plain));

  const cell = (i: number, register: 'plain' | 'polite') => {
    const spellings = conj.forms[i][register];
    if (!spellings) return '';
    const hit = matches.find(m => m.form === i && m.register === register);
    return hit ? `<mark>${esc(hit.text)}</mark>` : esc(spellings[0]);
  };
  const rows = conj.forms.map((f, i) => f.polite
    ? `<tr><th scope="row">${f.label}</th><td lang="ja">${cell(i, 'plain')}</td><td lang="ja" class="pol">${cell(i, 'polite')}</td></tr>`
    : `<tr><th scope="row">${f.label}</th><td lang="ja" colspan="2">${cell(i, 'plain')}</td></tr>`).join('');

  // One entry per spelling: an ichidan verb's 〜られる is both potential and passive.
  const names = new Map<string, string[]>();
  for (const m of matches) {
    const name = conj.forms[m.form].label.toLowerCase() + (m.register === 'polite' ? ', polite' : '');
    names.set(m.text, [...(names.get(m.text) ?? []), name]);
  }
  const used = [...names].map(([text, n]) => `<span lang="ja">${esc(text)}</span> (${n.join(' or ')})`);
  const note = used.length
    ? `In the sentence${record.examples.length > 1 ? 's' : ''}: ${used.join(', ')}.`
    : esc(conj.pattern);

  return `
    <details class="forms" data-forms>
      <summary><h3>Forms <span>${conj.className}</span></h3></summary>
      <p class="forms-note">${note}</p>
      <table>
        <thead><tr><td></td><th scope="col">Plain</th><th scope="col">Polite</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
}

function renderCard(record: WordRecord, index: number, total: number, isReview: boolean, base: string): string {
  const src = sourceName(record.sourceUrl);
  const saved = record.examples.find(e => e.articleText)?.articleText;
  const audio = audioTags([
    ['normal', record.wordAudioFile, 'audio-word'],
    ['slow', record.wordAudioFileSlow, 'audio-word'],
    ['vslow', record.wordAudioFileVslow, 'audio-word'],
    ...record.examples.flatMap((e, j): Array<[string, string | undefined, string, number]> => [
      ['normal', e.audioFile, 'audio-ex', j],
      ['slow', e.audioFileSlow, 'audio-ex', j],
      ['vslow', e.audioFileVslow, 'audio-ex', j],
    ]),
  ], base);

  const examples = record.examples.map((ex, j) => `
        <li class="ex">
          <button class="ex-play" type="button" data-play="ex" data-index="${j}" data-text="${esc(ex.plain)}" aria-pressed="false" aria-label="Play this sentence">${PLAY_ICON}</button>
          <div>
            <p class="jp" lang="ja">${ex.glossedHtml ?? ex.markedHtml}</p>
            ${ex.translationMarkedHtml ? `<details class="tr"><summary>English</summary><p>${ex.translationMarkedHtml}</p></details>` : ''}
          </div>
        </li>`).join('');

  const also = record.altDefinitions.length
    ? `<p class="also">Also ${esc(record.altDefinitions.slice(0, 3).join(', '))}</p>`
    : '';

  return `
  <section class="card${isReview ? ' is-review' : ''}" id="w${index + 1}" data-entry aria-label="Word ${index + 1} of ${total}">
    ${audio}
    <div class="facts">
      ${isReview ? `<span class="review">Review from ${shortDate(record.date)}</span>` : ''}
      <span class="level" title="JLPT level">${record.jlptLevel === 'unknown' ? 'No JLPT level' : record.jlptLevel}</span>
      <span>${esc(posLabel(record.pos))}</span>
    </div>
    <div class="head">
      <h2 class="word" lang="ja">${esc(record.word)}</h2>
      <button class="say" type="button" data-play="word" data-text="${esc(record.word)}" aria-pressed="false" aria-label="Play ${esc(record.word)}">${PLAY_ICON}</button>
    </div>

    <div class="answers">
      <div class="slot" data-slot="reading">
        <button class="cover" type="button" data-show="reading">${readingHint(record.reading)}<span class="cover-label">Show reading</span></button>
        <div class="val">
          <p class="reading" lang="ja">${esc(record.reading)}</p>
          <button class="hide" type="button" data-hide="reading">Hide</button>
        </div>
      </div>
      <div class="slot" data-slot="meaning">
        <button class="cover" type="button" data-show="meaning"><span class="cover-label">Show meaning</span></button>
        <div class="val">
          <div>
            <p class="meaning">${esc(record.definition)}</p>
            ${also}
          </div>
          <button class="hide" type="button" data-hide="meaning">Hide</button>
        </div>
      </div>
    </div>

    <div class="context">
      <div class="context-head">
        <h3>Where it came up</h3>
        <button type="button" class="chip" data-furi aria-pressed="false">Furigana</button>
      </div>
      <ol class="exs">${examples}
      </ol>
      <p class="src">
        <a href="${esc(record.sourceUrl)}" target="_blank" rel="noopener">Read the article on ${esc(src)}</a>
        ${saved ? `<button type="button" class="linkish" data-saved="${esc(saved)}" data-src="${esc(record.sourceUrl)}">Saved copy</button>` : ''}
      </p>
    </div>
${renderForms(record)}
  </section>`;
}

function nextDayHtml(next: string | null, base: string): string {
  const inner = next
    ? `<a href="${base}digest-${next}.html" rel="next" aria-label="Next day, ${shortDate(next)}">${shortDate(next)} <span aria-hidden="true">›</span></a>`
    : '<span aria-disabled="true">Next day</span>';
  return `${NEXT_START}${inner}${NEXT_END}`;
}

export interface DigestPageOptions {
  mode?: RunMode;
  /** Neighbouring digest ids (same mode), for the day links. */
  prev?: string | null;
  next?: string | null;
  /** Prefix for links to the site root and audio, for pages served from a subdirectory. */
  base?: string;
  /** Show the Custom link in the site nav. */
  showCustom?: boolean;
}

export function buildDigestPage(
  records: WordRecord[],
  date: string,
  reviewRecord: WordRecord | null,
  opts: DigestPageOptions = {},
): string {
  const { mode = 'auto', prev = null, next = null, base = '', showCustom = false } = opts;
  const all = [
    ...records.map(r => ({ r, review: false })),
    ...(reviewRecord ? [{ r: reviewRecord, review: true }] : []),
  ];
  const cards = all.map(({ r, review }, i) => renderCard(r, i, all.length, review, base)).join('\n');
  const tabs = all.map(({ r, review }, i) =>
    `<li><a href="#w${i + 1}" data-go="${i}" lang="ja"${review ? ' class="is-review" title="Review word"' : ''}>${esc(r.word)}</a></li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
${pageHead(`言葉の世界 ${longDate(date)}`)}
<style>
  ${BASE_CSS}

  /* ── The day ── */
  .day { display: flex; align-items: baseline; gap: 1rem; margin-top: 2rem; }
  .day h1 { font-size: 1rem; font-weight: 700; margin: 0; }
  .day .kind { font-weight: 400; color: var(--sub); margin-left: .5rem; }
  .daynav { margin-left: auto; display: flex; gap: .5rem; font-size: .88rem; }
  .daynav a, .daynav > span { padding: .35rem .7rem; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; white-space: nowrap; }
  .daynav a:hover { border-color: var(--line-strong); }
  .daynav > span { color: var(--muted); border-style: dashed; }

  /* The day's words as tabs: they're the table of contents and the progress. */
  .tabs { list-style: none; display: flex; gap: .25rem; padding: 0; margin: 1rem 0 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
  .tabs a { display: block; padding: .5rem .9rem .6rem; text-decoration: none; font-size: 1.1rem; font-weight: 600; color: var(--muted); white-space: nowrap; }
  .tabs a:hover { color: var(--ink); }
  .tabs a[aria-current] { color: var(--ink); box-shadow: inset 0 -3px 0 var(--signal); }
  .tabs a.is-review::after { content: "review"; font-size: .7rem; font-weight: 500; margin-left: .4rem; color: var(--muted); }

  /* ── The card ── */
  main { padding-bottom: 8rem; }
  .card { padding: 2.5rem 0 1rem; }
  .js .card:not(.current) { display: none; }
  .facts { display: flex; gap: .9rem; align-items: baseline; font-size: .88rem; color: var(--sub); }
  .level { font-weight: 800; color: var(--ink); }
  .review { color: var(--signal); font-weight: 700; }

  .head { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; }
  .word { font-size: clamp(5rem, 24vw, 10.5rem); font-weight: 800; line-height: 1.05; letter-spacing: .02em; margin: .5rem 0 .25rem -.04em; }
  /* Review words are drawn in outline: seen before, being traced again. */
  .is-review .word { color: transparent; -webkit-text-stroke: clamp(1.5px, .45vw, 2.5px) var(--ink); }
  .say { width: 3.5rem; height: 3.5rem; border-radius: 50%; border: 1.5px solid var(--line-strong); background: none; cursor: pointer;
    display: grid; place-items: center; flex-shrink: 0; }
  .say svg, .ex-play svg { width: 40%; fill: currentColor; margin-left: 8%; }
  .say:hover, .ex-play:hover { border-color: var(--signal); color: var(--signal); }
  .playing { background: var(--signal) !important; color: var(--ground) !important; border-color: var(--signal) !important; }

  /* Answer slots: a covered button until shown; "Hide" covers it again. */
  .answers { display: grid; grid-template-columns: minmax(10rem, 1fr) 2fr; gap: 1rem; margin-top: 1.5rem; }
  .slot { position: relative; min-height: 5.25rem; }
  .cover { position: absolute; inset: 0; width: 100%; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: .4rem;
    padding: .9rem 1.1rem; background: var(--surface); border: 1.5px dashed var(--line-strong); border-radius: 10px; cursor: pointer;
    font-size: .9rem; color: var(--sub); text-align: left; }
  .cover:hover { border-color: var(--signal); color: var(--ink); }
  .dots { display: flex; align-items: center; gap: .35rem; }
  .dots i { width: .7rem; height: .7rem; border-radius: 50%; border: 1.5px solid var(--line-strong); }
  .dots i.sm { width: .45rem; height: .45rem; border-width: 1.25px; }
  .dots-note { font-size: .75rem; color: var(--muted); }
  .cover-label { margin-top: .1rem; }
  .val { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; min-height: 100%;
    padding: .9rem 1.1rem; border-left: 3px solid var(--signal); visibility: hidden; }
  .slot.open .cover { display: none; }
  .slot.open .val { visibility: visible; animation: in .22s ease-out; }
  @keyframes in { from { opacity: 0; transform: translateY(4px); } }
  .reading { font-size: 1.9rem; font-weight: 500; line-height: 1.3; }
  .meaning { font-size: 1.5rem; font-weight: 700; line-height: 1.25; }
  .also { color: var(--sub); margin-top: .3rem; font-size: .95rem; }
  .hide { flex-shrink: 0; font-size: .8rem; color: var(--muted); background: none; border: 1px solid var(--line); border-radius: 999px;
    padding: .25rem .7rem; min-height: 2rem; cursor: pointer; }
  .hide:hover { color: var(--ink); border-color: var(--line-strong); }

  /* ── Context ── */
  .context { margin-top: 3rem; }
  .context-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: .6rem; border-bottom: 1px solid var(--line); }
  .context h3 { font-size: 1rem; font-weight: 700; }
  .chip { font-size: .82rem; padding: .35rem .8rem; border-radius: 999px; border: 1px solid var(--line-strong); background: none; cursor: pointer; min-height: 2.25rem; }
  .chip[aria-pressed="true"] { background: var(--ink); color: var(--ground); border-color: var(--ink); }
  .exs { list-style: none; padding: 0; }
  .ex { display: grid; grid-template-columns: 2.75rem 1fr; gap: .75rem; padding: 1.1rem 0; border-bottom: 1px solid var(--line); }
  .ex-play { width: 2.75rem; height: 2.75rem; border-radius: 50%; border: 1px solid var(--line-strong); background: none; cursor: pointer; display: grid; place-items: center; }
  .ex .jp { font-size: 1.12rem; line-height: 2.1; max-width: 38em; }
  :root.furi-on .ex .jp { line-height: 2.5; }
  .tr { margin-top: .35rem; font-size: .92rem; color: var(--sub); }
  .tr summary { cursor: pointer; width: max-content; color: var(--muted); font-size: .82rem; padding: .2rem 0; }
  .tr summary:hover { color: var(--ink); }
  .tr p { margin-top: .3rem; max-width: 36em; }
  .tr mark { background: none; color: var(--ink); font-weight: 700; }
  .src { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; margin-top: 1rem; font-size: .88rem; color: var(--sub); }
  .linkish { background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; color: var(--sub); }
  .linkish:hover { color: var(--ink); text-decoration-color: var(--signal); }

  /* Furigana: real <rt> when .furi-on is set, otherwise a tooltip on hover or first tap. */
  .jp ruby { position: relative; }
  .jp rt { font-size: .52em; font-weight: 500; color: var(--sub); }
  :root:not(.furi-on) .jp rt { display: none; }
  :root:not(.furi-on) .jp ruby::after {
    content: attr(data-reading); position: absolute; bottom: 100%; left: 50%;
    transform: translate(-50%, -6px); background: var(--raised); color: var(--ink);
    border: 1px solid var(--line-strong); border-radius: 6px; padding: .25em .6em;
    font-size: .8rem; font-weight: 600; white-space: nowrap; box-shadow: var(--shadow);
    display: none; pointer-events: none; z-index: 20;
  }
  :root:not(.furi-on) .jp ruby:hover::after, :root:not(.furi-on) .jp a.tap-active ruby::after { display: block; }
  .jp .gloss-link { color: inherit; text-decoration: none; border-bottom: 1px dotted var(--line-strong); }
  .jp .gloss-link:hover { border-bottom-color: var(--signal); background: var(--surface); }
  .jp mark { background: var(--wash); color: var(--ink); font-weight: 700; padding: 0 .12em; border-radius: 2px; box-shadow: inset 0 -2px 0 var(--signal); }
  .jp mark rt { color: var(--signal); }

  /* ── Forms: how the word conjugates; the form from the sentence is marked like the word in it ── */
  .forms { margin-top: 3rem; }
  /* Closed by default; the open/closed choice is remembered across words and days. */
  .forms summary { list-style: none; cursor: pointer; padding-bottom: .6rem; border-bottom: 1px solid var(--line); }
  .forms summary::-webkit-details-marker { display: none; }
  .forms h3 { display: flex; align-items: baseline; font-size: 1rem; font-weight: 700; }
  .forms h3::after { content: ""; width: .45rem; height: .45rem; margin-left: auto; align-self: center;
    border-right: 1.5px solid var(--sub); border-bottom: 1.5px solid var(--sub); transform: translateY(-25%) rotate(45deg); transition: transform .15s; }
  .forms[open] h3::after { transform: translateY(25%) rotate(-135deg); }
  .forms summary:hover h3, .forms summary:hover h3 span { color: var(--ink); }
  .forms summary:hover h3::after { border-color: var(--signal); }
  .forms h3 span { font-weight: 400; color: var(--sub); margin-left: .5rem; }
  .forms-note { margin: .9rem 0 .4rem; font-size: .92rem; color: var(--sub); max-width: 36em; }
  .forms-note span { color: var(--ink); font-weight: 700; }
  .forms table { border-collapse: collapse; width: 100%; max-width: 38rem; }
  .forms th, .forms td { text-align: left; padding: .55rem 1rem .55rem 0; border-bottom: 1px solid var(--line); vertical-align: baseline; }
  .forms thead th { font-size: .8rem; font-weight: 500; color: var(--muted); padding-top: .3rem; }
  .forms tbody th { font-size: .88rem; font-weight: 500; color: var(--sub); white-space: nowrap; width: 8.5rem; }
  .forms tbody td { font-size: 1.12rem; }
  .forms mark { background: var(--wash); color: var(--ink); font-weight: 700; padding: 0 .12em; border-radius: 2px; box-shadow: inset 0 -2px 0 var(--signal); }

  /* ── Bottom bar: the thumb's-reach controls ── */
  .bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: color-mix(in oklab, var(--ground) 88%, transparent);
    backdrop-filter: blur(10px); border-top: 1px solid var(--line); padding: .7rem 0 calc(.7rem + env(safe-area-inset-bottom)); }
  .bar .wrap { display: flex; align-items: center; gap: .6rem; }
  .bar button { min-height: 3rem; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--surface); cursor: pointer; padding: 0 1rem; font-size: .95rem; }
  .bar button:hover { border-color: var(--ink); }
  .bar button:disabled { opacity: .4; cursor: default; }
  .bar .count { font-size: .88rem; color: var(--sub); margin: 0 auto; }
  .bar .primary { background: var(--signal); color: var(--ground); border-color: var(--signal); font-weight: 700; min-width: 11rem; }
  .bar .primary:hover { border-color: var(--ink); }
  .bar kbd { font: inherit; font-size: .72rem; opacity: .7; margin-left: .5rem; border: 1px solid currentColor; border-radius: 4px; padding: 0 .3rem; }
  .no-js .bar { display: none; }


  @media (max-width: 640px) {
    .day { flex-wrap: wrap; margin-top: 1.25rem; }
    .answers { grid-template-columns: 1fr; }
    /* Too narrow for three columns: the label goes above, plain and polite share a line or wrap. */
    .forms thead { display: none; }
    .forms tr { display: flex; flex-wrap: wrap; gap: .15rem 1.25rem; padding: .6rem 0; border-bottom: 1px solid var(--line); }
    .forms th, .forms td { border: 0; padding: 0; }
    .forms tbody th { flex-basis: 100%; width: auto; font-size: .8rem; }
    .forms tbody td { font-size: 1.05rem; }
    .forms .pol::before { content: "polite "; font-size: .75rem; color: var(--muted); }
    .bar .count, .bar kbd { display: none; }
    .bar .primary { flex: 1; min-width: 0; }
    .bar .wrap { padding: 0 .75rem; }
  }
</style>
</head>
<body class="no-js">
<div class="wrap">
  ${siteHeader(null, showCustom, base)}

  <div class="day">
    <h1>${esc(longDate(date))}${mode === 'manual' ? '<span class="kind">Custom run</span>' : ''}</h1>
    <nav class="daynav" aria-label="Other days">
      ${prev ? `<a href="${base}digest-${prev}.html" rel="prev" aria-label="Previous day, ${shortDate(prev)}"><span aria-hidden="true">‹</span> ${shortDate(prev)}</a>` : ''}
      ${nextDayHtml(next, base)}
    </nav>
  </div>
  <ol class="tabs" aria-label="Words on this page">${tabs}</ol>

  <main id="cards">
    ${cards}
  </main>

  ${siteFooter(`Words collected from Japanese news and reading sites. Readings and meanings looked up on ${esc(longDate(date))}.`)}
</div>

<div class="bar" role="toolbar" aria-label="Word controls">
  <div class="wrap">
    <button type="button" id="prev" aria-label="Previous word">Back</button>
    <button type="button" id="speed" aria-label="Playback speed">Speed 1×</button>
    <span class="count" id="count" aria-live="polite"></span>
    <button type="button" id="next" class="primary">Show reading<kbd>Space</kbd></button>
  </div>
</div>

<script>
(function () {
  document.body.classList.remove('no-js');
  document.documentElement.classList.add('js');

  /* ── Audio: recorded file at the chosen speed, else Web Speech ── */
  var SPEED_KEY = 'kotoba-speed';
  var speechRates = { normal: 0.9, slow: 0.65, vslow: 0.45 };
  var speed = 'normal';
  try { speed = localStorage.getItem(SPEED_KEY) || 'normal'; } catch (e) {}

  var playingBtn = null;
  function stopAll() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    document.querySelectorAll('audio').forEach(function (a) { a.pause(); a.currentTime = 0; });
    if (playingBtn) { playingBtn.classList.remove('playing'); playingBtn.setAttribute('aria-pressed', 'false'); playingBtn = null; }
  }
  function say(text, done) {
    if (!window.speechSynthesis) { done(); return; }
    var u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; u.rate = speechRates[speed] || 0.9; u.onend = done;
    speechSynthesis.speak(u);
  }
  function play(btn) {
    if (btn.classList.contains('playing')) { stopAll(); return; }
    stopAll();
    playingBtn = btn; btn.classList.add('playing'); btn.setAttribute('aria-pressed', 'true');
    var entry = btn.closest('[data-entry]');
    var sel = btn.dataset.play === 'word' ? '.audio-word' : '.audio-ex[data-index="' + btn.dataset.index + '"]';
    var el = entry.querySelector(sel + '[data-speed="' + speed + '"]') || entry.querySelector(sel + '[data-speed="normal"]');
    function done() { if (playingBtn === btn) stopAll(); }
    if (el) { el.currentTime = 0; el.onended = done; el.play().catch(function () { say(btn.dataset.text, done); }); }
    else say(btn.dataset.text, done);
  }

  /* ── Saved copy of the article, for when the source link is dead ── */
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function openSaved(btn) {
    var win = window.open('', '_blank'); if (!win) return;
    var text = escapeHtml(btn.dataset.saved || ''), src = escapeHtml(btn.dataset.src || '');
    win.document.write('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Saved article text</title><style>body{font-family:"Hiragino Sans","Yu Gothic",sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.9;white-space:pre-wrap}.note{color:#666;font-size:.85rem;border-bottom:1px solid #ddd;padding-bottom:1rem;margin-bottom:1rem;white-space:normal}</style></head><body><p class="note">Saved copy of the article, in case the original link no longer works.<br>Original: <a href="' + src + '">' + src + '</a></p>' + text + '</body></html>');
    win.document.close();
  }

  /* ── Word-by-word flow ── */
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-go]'));
  var nextBtn = document.getElementById('next'), prevBtn = document.getElementById('prev');
  var count = document.getElementById('count'), speedBtn = document.getElementById('speed');
  var i = Math.max(0, cards.findIndex(function (c) { return '#' + c.id === location.hash; }));

  function isOpen(c, slot) { return c.querySelector('[data-slot="' + slot + '"]').classList.contains('open'); }
  function setOpen(slot, open) {
    var s = cards[i].querySelector('[data-slot="' + slot + '"]');
    s.classList.toggle('open', open);
    // Keep focus on the matching control so keyboard users don't lose their place.
    var target = s.querySelector(open ? '[data-hide]' : '[data-show]');
    if (s.contains(document.activeElement)) target.focus({ preventScroll: true });
    render();
  }
  function render() {
    cards.forEach(function (c, j) { c.classList.toggle('current', j === i); });
    tabs.forEach(function (t, j) { if (j === i) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current'); });
    var c = cards[i], last = i === cards.length - 1;
    var label = !isOpen(c, 'reading') ? 'Show reading' : !isOpen(c, 'meaning') ? 'Show meaning' : last ? 'Done for today' : 'Next word';
    nextBtn.firstChild.nodeValue = label;
    nextBtn.disabled = label === 'Done for today';
    prevBtn.disabled = i === 0;
    count.textContent = 'Word ' + (i + 1) + ' of ' + cards.length;
  }
  function go(j) {
    if (j < 0 || j >= cards.length) return;
    stopAll(); i = j; history.replaceState(null, '', '#' + cards[i].id); render(); window.scrollTo({ top: 0 });
  }
  function advance() {
    var c = cards[i];
    if (!isOpen(c, 'reading')) setOpen('reading', true);
    else if (!isOpen(c, 'meaning')) setOpen('meaning', true);
    else go(i + 1);
  }

  nextBtn.addEventListener('click', advance);
  prevBtn.addEventListener('click', function () { go(i - 1); });
  tabs.forEach(function (t, j) { t.addEventListener('click', function (e) { e.preventDefault(); go(j); }); });

  document.addEventListener('click', function (e) {
    var b;
    if ((b = e.target.closest('[data-play]'))) play(b);
    else if ((b = e.target.closest('[data-saved]'))) openSaved(b);
    else if ((b = e.target.closest('[data-show]'))) setOpen(b.dataset.show, true);
    else if ((b = e.target.closest('[data-hide]'))) setOpen(b.dataset.hide, false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, textarea, select, summary, a, button:not(#next)') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); }
    else if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'p') cards[i].querySelector('.say').click();
    else if (e.key === 'h') { setOpen('reading', false); setOpen('meaning', false); }
  });

  var SPEEDS = ['normal', 'slow', 'vslow'], SPEED_LABEL = { normal: '1×', slow: '¾×', vslow: '½×' };
  function showSpeed() { speedBtn.textContent = 'Speed ' + SPEED_LABEL[speed]; }
  speedBtn.addEventListener('click', function () {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % 3];
    try { localStorage.setItem(SPEED_KEY, speed); } catch (e) {}
    showSpeed();
  });
  showSpeed();

  /* ── Furigana on/off, remembered ── */
  var furi = false;
  try { furi = localStorage.getItem('kotoba-furigana') === 'on'; } catch (e) {}
  function showFuri() {
    document.documentElement.classList.toggle('furi-on', furi);
    document.querySelectorAll('[data-furi]').forEach(function (b) { b.setAttribute('aria-pressed', String(furi)); });
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-furi]')) return;
    furi = !furi; try { localStorage.setItem('kotoba-furigana', furi ? 'on' : 'off'); } catch (x) {}
    showFuri();
  });
  showFuri();

  /* ── Forms table open/closed, remembered ── */
  var formsOpen = false;
  try { formsOpen = localStorage.getItem('kotoba-forms') === 'open'; } catch (e) {}
  document.querySelectorAll('[data-forms]').forEach(function (d) { d.open = formsOpen; });
  // toggle doesn't bubble, so listen in the capture phase.
  document.addEventListener('toggle', function (e) {
    if (!e.target.matches || !e.target.matches('[data-forms]') || e.target.open === formsOpen) return;
    formsOpen = e.target.open;
    try { localStorage.setItem('kotoba-forms', formsOpen ? 'open' : 'closed'); } catch (x) {}
    document.querySelectorAll('[data-forms]').forEach(function (d) { d.open = formsOpen; });
  }, true);

  /* Furigana tap-to-reveal on touch: with furigana off, the first tap on a
     linked word shows its reading instead of following the link; a second
     tap follows it. Mouse clicks and keyboard activation navigate at once. */
  var lastPointer = '';
  document.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType; }, true);
  document.addEventListener('click', function (e) {
    var link = e.target.closest('.jp a');
    if (link && !furi && e.detail !== 0 && lastPointer === 'touch' && link.querySelector('ruby') && !link.classList.contains('tap-active')) {
      e.preventDefault();
      document.querySelectorAll('.tap-active').forEach(function (el) { el.classList.remove('tap-active'); });
      link.classList.add('tap-active');
      return;
    }
    document.querySelectorAll('.tap-active').forEach(function (el) { if (!el.contains(e.target)) el.classList.remove('tap-active'); });
  });

  render();
})();
</script>
</body>
</html>`;
}

// ── Neighbouring days ─────────────────────────────────────

const DIGEST_RE = /^digest-(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.html$/;

/** Digest ids on disk for one mode, oldest first. Manual runs are the ones in manual-manifest.json. */
function digestIds(outputDir: string, mode: RunMode): string[] {
  const dir = path.resolve(process.cwd(), outputDir);
  let manual = new Set<string>();
  try {
    const entries = JSON.parse(fs.readFileSync(path.join(dir, 'manual-manifest.json'), 'utf8')) as Array<{ date: string }>;
    manual = new Set(entries.map(e => e.date));
  } catch { /* no manual runs yet */ }
  let files: string[] = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files
    .map(f => f.match(DIGEST_RE)?.[1])
    .filter((id): id is string => !!id && manual.has(id) === (mode === 'manual'))
    .sort();
}

function neighbours(ids: string[], date: string): { prev: string | null; next: string | null } {
  const earlier = ids.filter(id => id < date);
  const later = ids.filter(id => id > date);
  return { prev: earlier.at(-1) ?? null, next: later[0] ?? null };
}

/** Point the previous digest's "next day" control at this one (pages written before this existed have no marker; left alone). */
function linkFromPrevious(outputDir: string, prev: string, date: string): void {
  const p = resolveOutputPath(outputDir, `digest-${prev}.html`);
  let html: string;
  try { html = fs.readFileSync(p, 'utf8'); } catch { return; }
  const start = html.indexOf(NEXT_START), end = html.indexOf(NEXT_END);
  if (start < 0 || end < start) return;
  const updated = html.slice(0, start) + nextDayHtml(date, '') + html.slice(end + NEXT_END.length);
  if (updated !== html) fs.writeFileSync(p, updated, 'utf8');
}

export function writeHtmlOutput(
  records: WordRecord[],
  date: string,
  outputDir: string,
  reviewRecord: WordRecord | null = null,
  mode: RunMode = 'auto',
): string {
  const filename = `digest-${date}.html`;
  const ids = [...new Set([...digestIds(outputDir, mode), date])].sort();
  const { prev, next } = neighbours(ids, date);
  const html = buildDigestPage(records, date, reviewRecord, { mode, prev, next, showCustom: hasCustomRuns(outputDir) || mode === 'manual' });
  const outPath = resolveOutputPath(outputDir, filename);
  fs.writeFileSync(outPath, html, 'utf8');
  if (prev) linkFromPrevious(outputDir, prev, date);
  console.log(`[output] HTML → ${outPath}`);
  return outPath;
}

/**
 * Re-render every digest page from its words-<date>.json, so older days pick
 * up the current design. Only rewrites digests that already exist on disk.
 */
export function rebuildDigests(outputDir: string, jsonOutputDir: string): void {
  let count = 0;
  const showCustom = hasCustomRuns(outputDir);
  for (const mode of ['auto', 'manual'] as RunMode[]) {
    const ids = digestIds(outputDir, mode);
    for (const id of ids) {
      const jsonPath = path.resolve(process.cwd(), jsonOutputDir, `words-${id}.json`);
      if (!fs.existsSync(jsonPath)) {
        console.warn(`[output] Skipping digest-${id}.html: no ${path.basename(jsonPath)}`);
        continue;
      }
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const records: WordRecord[] = data.fullRecords ?? data;
      const { prev, next } = neighbours(ids, id);
      const html = buildDigestPage(records, id, data.reviewWord ?? null, { mode, prev, next, showCustom });
      fs.writeFileSync(resolveOutputPath(outputDir, `digest-${id}.html`), html, 'utf8');
      count++;
    }
  }
  console.log(`[output] ${count} digest page${count !== 1 ? 's' : ''} rebuilt`);
}
