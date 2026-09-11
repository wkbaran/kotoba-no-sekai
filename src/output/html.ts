import fs from 'fs';
import type { WordRecord, JlptLevel } from '../types.js';
import { resolveOutputPath } from '../config.js';
import { ATTRIBUTION_HTML, ATTRIBUTION_CSS } from './attribution.js';

function jlptBadge(level: JlptLevel): string {
  return `<span class="badge badge-jlpt badge-${level.toLowerCase()}">${level}</span>`;
}

function domainBadge(domain: string): string {
  return `<span class="badge badge-domain">${domain}</span>`;
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function audioEls(srcs: Array<[string, string]>, cls: string, extra = ''): string {
  return srcs
    .filter(([, src]) => !!src)
    .map(([speed, src]) => `<audio class="${cls}" data-speed="${speed}"${extra} src="${src}" preload="none"></audio>`)
    .join('');
}

function renderCard(record: WordRecord, isReview = false): string {
  const wordAudioEl = audioEls([
    ['normal', record.wordAudioFile      ?? ''],
    ['slow',   record.wordAudioFileSlow  ?? ''],
    ['vslow',  record.wordAudioFileVslow ?? ''],
  ], 'audio-word');

  const examples = record.examples.map((ex, i) => {
    // Review words backfilled from before glossedHtml/articleText existed won't
    // have them in their stored snapshot — fall back to the always-present
    // markedHtml rather than crashing on undefined.
    const linked = (ex.glossedHtml ?? ex.markedHtml).replace(
      /<mark>(.*?)<\/mark>/g,
      `<a href="${ex.sourceUrl}" target="_blank" rel="noopener" class="source-link"><mark>$1</mark></a>`
    );
    const audioEl = audioEls([
      ['normal', ex.audioFile      ?? ''],
      ['slow',   ex.audioFileSlow  ?? ''],
      ['vslow',  ex.audioFileVslow ?? ''],
    ], 'audio-ex', ` data-index="${i}"`);
    const translationEl = ex.translationMarkedHtml
      ? `<p class="example-translation">${ex.translationMarkedHtml}</p>`
      : '';
    const exPlayBtn = `<button class="play-btn play-ex" data-text="${escapeAttr(ex.plain)}" data-index="${i}" aria-label="Play example" title="Play example">▶</button>`;
    const backupBtn = ex.articleText
      ? `<button class="backup-btn" data-article-text="${escapeAttr(ex.articleText)}" data-source-url="${escapeAttr(ex.sourceUrl)}" aria-label="View saved article text" title="If the source link above is dead, view a saved copy of the article text">🗄</button>`
      : '';
    return `<blockquote class="example" data-index="${i}"><div class="example-top">${exPlayBtn}<span>${linked}</span>${backupBtn}</div>${audioEl}${translationEl}</blockquote>`;
  }).join('\n');

  const altDefs = record.altDefinitions.length > 0
    ? `<p class="alt-defs"><em>Also:</em> ${record.altDefinitions.slice(0, 3).join('; ')}</p>`
    : '';

  // Play button data attributes carry text for Web Speech fallback
  const playBtn = `<button class="play-btn play-word"
      data-word="${escapeAttr(record.word)}"
      data-reading="${escapeAttr(record.reading)}"
      aria-label="Play pronunciation"
      title="Play word">▶</button>`;

  const reviewBadge = isReview ? '<span class="badge badge-review">Review</span>' : '';

  return `
  <article class="word-card${isReview ? ' card-review' : ''}">
    ${wordAudioEl}
    <div class="card-header">
      <div class="word-main">
        <span class="word-kanji">${record.word}</span>
        <span class="word-reading">【${record.reading}】</span>
        ${playBtn}
      </div>
      <div class="badges">
        ${reviewBadge}
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

function buildPage(records: WordRecord[], date: string, reviewRecord: WordRecord | null): string {
  const cards = records.map(r => renderCard(r)).join('\n');
  const reviewCard = reviewRecord ? renderCard(reviewRecord, true) : '';

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

    /* ── Dark theme (default) ── */
    :root {
      --surface:      #1e1e2e;
      --bg:           #13131f;
      --text:         #cdd6f4;
      --muted:        #6c7086;
      --accent:       #89b4fa;
      --example-bg:   #181825;
      --example-border: #313244;
      --example-text: #bac2de;
      --mark-bg:      #f9e2af33;
      --mark-hover:   #f9e2af66;
      --shadow:       0 2px 12px rgba(0,0,0,.4);
      --radius:       10px;

      /* JLPT badge colors — dark */
      --n5-bg: #1a3a2a; --n5-fg: #a6e3a1; --n5-border: #40a02b;
      --n4-bg: #1e3a1e; --n4-fg: #94e2d5; --n4-border: #179299;
      --n3-bg: #3a2e0a; --n3-fg: #f9e2af; --n3-border: #df8e1d;
      --n2-bg: #3a1a0a; --n2-fg: #fab387; --n2-border: #fe640b;
      --n1-bg: #3a0f0f; --n1-fg: #f38ba8; --n1-border: #d20f39;
      --uk-bg: #232634; --uk-fg: #a6adc8; --uk-border: #45475a;

      /* card left-border: teal for everything, green only for review */
      --card-default: #179299;
      --card-review: #40a02b;

      /* domain badge */
      --domain-bg: #1e2a45; --domain-fg: #89b4fa; --domain-border: #3b5998;
    }

    /* ── Light theme ── */
    [data-theme="light"] {
      --surface:      #ffffff;
      --bg:           #f8f9fa;
      --text:         #212529;
      --muted:        #6c757d;
      --accent:       #5c6bc0;
      --example-bg:   #f1f3f5;
      --example-border: #dee2e6;
      --example-text: #343a40;
      --mark-bg:      #fff9c4;
      --mark-hover:   #ffe082;
      --shadow:       0 2px 8px rgba(0,0,0,.08);

      --n5-bg: #e8f5e9; --n5-fg: #2e7d32; --n5-border: #4caf50;
      --n4-bg: #f1f8e9; --n4-fg: #558b2f; --n4-border: #8bc34a;
      --n3-bg: #fff8e1; --n3-fg: #f57f17; --n3-border: #ffc107;
      --n2-bg: #fff3e0; --n2-fg: #e65100; --n2-border: #ff9800;
      --n1-bg: #fce4ec; --n1-fg: #c62828; --n1-border: #ef5350;
      --uk-bg: #f5f5f5; --uk-fg: #616161; --uk-border: #9e9e9e;

      --card-default: #00897b;
      --card-review: #4caf50;

      --domain-bg: #e8eaf6; --domain-fg: #3949ab; --domain-border: #7986cb;
    }

    body {
      font-family: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
      padding: 2rem 1rem;
      transition: background .25s, color .25s;
    }

    /* ── Header ── */
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
      border: 1px solid var(--example-border);
      color: var(--muted);
      border-radius: 20px;
      padding: .3em .75em;
      font-size: .8rem;
      cursor: pointer;
      transition: color .2s, border-color .2s;
    }

    .theme-toggle:hover { color: var(--text); border-color: var(--muted); }

    .speed-picker {
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      gap: .25rem;
    }

    .speed-btn {
      background: var(--surface);
      border: 1px solid var(--example-border);
      color: var(--muted);
      border-radius: 20px;
      padding: .3em .6em;
      font-size: .8rem;
      cursor: pointer;
      transition: color .2s, background .2s, border-color .2s;
    }

    .speed-btn.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
    .speed-btn:hover:not(.active) { color: var(--text); border-color: var(--muted); }

    /* ── Grid ── */
    .word-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1.25rem;
      max-width: 1100px;
      margin: 0 auto;
    }

    /* ── Cards ── */
    .word-card {
      background: var(--surface);
      border-radius: var(--radius);
      border-left: 4px solid var(--card-default);
      padding: 1.25rem 1.5rem;
      box-shadow: var(--shadow);
      transition: box-shadow .2s, background .25s;
    }

    .word-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.3); }

    /* Only two left-border colors on this page: teal (default) and green
       (review), regardless of JLPT level — level is already shown via badge. */
    .card-review { border-left-color: var(--card-review); }

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

    .word-kanji  { font-size: 1.75rem; font-weight: 700; }
    .word-reading { font-size: 1rem; color: var(--muted); }

    .play-btn {
      background: none;
      border: 1px solid var(--example-border);
      color: var(--muted);
      border-radius: 50%;
      width: 1.8rem;
      height: 1.8rem;
      font-size: .75rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color .15s, border-color .15s, transform .1s;
      flex-shrink: 0;
      align-self: center;
    }

    .play-btn:hover  { color: var(--accent); border-color: var(--accent); }
    .play-btn.playing { color: var(--accent); border-color: var(--accent); transform: scale(1.1); }

    /* ── Badges ── */
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
      border: 1px solid;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .badge-n5      { background: var(--n5-bg); color: var(--n5-fg); border-color: var(--n5-border); }
    .badge-n4      { background: var(--n4-bg); color: var(--n4-fg); border-color: var(--n4-border); }
    .badge-n3      { background: var(--n3-bg); color: var(--n3-fg); border-color: var(--n3-border); }
    .badge-n2      { background: var(--n2-bg); color: var(--n2-fg); border-color: var(--n2-border); }
    .badge-n1      { background: var(--n1-bg); color: var(--n1-fg); border-color: var(--n1-border); }
    .badge-unknown { background: var(--uk-bg); color: var(--uk-fg); border-color: var(--uk-border); }
    .badge-domain  { background: var(--domain-bg); color: var(--domain-fg); border-color: var(--domain-border); }
    .badge-review  { background: var(--accent); color: var(--bg); border-color: var(--accent); }

    /* ── Word info ── */
    .pos        { font-size: .8rem; color: var(--muted); margin-bottom: .3rem; font-style: italic; }
    .definition { font-size: 1.05rem; font-weight: 500; margin-bottom: .25rem; }
    .alt-defs   { font-size: .85rem; color: var(--muted); margin-bottom: .5rem; }

    .example-translation {
      margin-top: .4rem;
      font-size: .85rem;
      color: var(--muted);
      font-style: italic;
    }

    /* ── Examples ── */
    .example {
      margin-top: .75rem;
      padding: .6rem 1rem;
      background: var(--example-bg);
      border-left: 3px solid var(--example-border);
      border-radius: 0 var(--radius) var(--radius) 0;
      font-size: .95rem;
      color: var(--example-text);
      transition: background .25s;
      display: flex;
      flex-direction: column;
      gap: .25rem;
    }

    .example-top {
      display: flex;
      align-items: baseline;
      gap: .5rem;
    }

    .example-top .play-btn {
      font-size: .65rem;
      width: 1.5rem;
      height: 1.5rem;
      flex-shrink: 0;
      align-self: center;
    }

    .backup-btn {
      background: none;
      border: 1px solid var(--example-border);
      color: var(--muted);
      border-radius: 50%;
      width: 1.5rem;
      height: 1.5rem;
      font-size: .7rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      align-self: center;
      margin-left: auto;
      transition: color .15s, border-color .15s;
    }

    .backup-btn:hover { color: var(--accent); border-color: var(--accent); }

    .example mark {
      background: var(--mark-bg);
      color: inherit;
      border-radius: 2px;
      padding: 0 2px;
      font-weight: 700;
    }

    .source-link { color: inherit; text-decoration: none; }
    .source-link:hover mark { background: var(--mark-hover); text-decoration: underline; }

    /* Native <rt> is kept in the DOM for semantics/accessibility, but hidden —
       it's replaced visually by a proper popup tooltip below (real furigana
       renders too small to read comfortably as a hover reveal). */
    .example rt {
      display: none;
    }

    .example ruby {
      position: relative;
    }

    .example ruby::after {
      content: attr(data-reading);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%) translateY(-6px);
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--example-border);
      border-radius: 6px;
      padding: .3em .65em;
      font-size: .8rem;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: var(--shadow);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity .12s ease;
      z-index: 20;
    }

    .example ruby:hover::after,
    .example a.tap-active ruby::after {
      opacity: 1;
      visibility: visible;
    }

    .gloss-link {
      color: inherit;
      text-decoration: none;
      border-bottom: 1px dotted var(--muted);
      cursor: pointer;
    }

    .gloss-link:hover {
      border-bottom-color: var(--accent);
      background: var(--example-border);
      border-radius: 2px;
    }

    /* ── Footer ── */
    .site-footer {
      text-align: center;
      margin-top: 3rem;
      color: var(--muted);
      font-size: .8rem;
    }

    ${ATTRIBUTION_CSS}
  </style>
</head>
<body>
  <header class="site-header">
    <div class="speed-picker" id="speedPicker">
      <button class="speed-btn" data-speed="normal">1×</button>
      <button class="speed-btn" data-speed="slow">¾×</button>
      <button class="speed-btn" data-speed="vslow">½×</button>
    </div>
    <h1 class="site-title">言葉の世界</h1>
    <p class="site-subtitle">${date} · ${records.length} word${records.length !== 1 ? 's' : ''}${reviewRecord ? ' · 1 review' : ''}</p>
    <button class="theme-toggle" id="themeToggle" aria-label="Toggle light/dark mode">☀ Light</button>
  </header>

  <div class="word-grid">
    ${cards}
    ${reviewCard}
  </div>

  <footer class="site-footer">
    <p>Generated by <strong>Kotoba no Sekai</strong> on ${date}</p>
    ${ATTRIBUTION_HTML}
  </footer>

  <script>
    (function () {

      /* ── Theme toggle ── */
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

      /* ── Speed picker ── */

      var speechRates  = { normal: 0.9, slow: 0.65, vslow: 0.45 };
      var currentSpeed = localStorage.getItem('kotoba-speed') || 'normal';

      var speedBtns = document.querySelectorAll('.speed-btn');
      speedBtns.forEach(function (b) {
        if (b.dataset.speed === currentSpeed) b.classList.add('active');
        b.addEventListener('click', function () {
          currentSpeed = b.dataset.speed;
          localStorage.setItem('kotoba-speed', currentSpeed);
          speedBtns.forEach(function (x) {
            x.classList.toggle('active', x.dataset.speed === currentSpeed);
          });
        });
      });

      /* ── Audio playback ── */

      var currentBtn = null;

      function speak(text, onEnd) {
        var utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'ja-JP';
        utt.rate = speechRates[currentSpeed] || 0.9;
        utt.onend = onEnd || null;
        speechSynthesis.cancel();
        speechSynthesis.speak(utt);
      }

      function playAudioEl(audioEl, onEnd) {
        audioEl.currentTime = 0;
        audioEl.onended = onEnd || null;
        audioEl.play().catch(function () { if (onEnd) onEnd(); });
      }

      function markPlaying(btn, on) {
        if (currentBtn && currentBtn !== btn) {
          currentBtn.classList.remove('playing');
          currentBtn.textContent = '▶';
        }
        btn.classList.toggle('playing', on);
        btn.textContent = on ? '■' : '▶';
        currentBtn = on ? btn : null;
      }

      function stopAll() {
        speechSynthesis.cancel();
        document.querySelectorAll('audio').forEach(function (a) { a.pause(); a.currentTime = 0; });
        if (currentBtn) { markPlaying(currentBtn, false); }
      }

      function pickAudio(card, cls, extra) {
        return card.querySelector(cls + '[data-speed="' + currentSpeed + '"]' + extra)
            || card.querySelector(cls + '[data-speed="normal"]' + extra);
      }

      /* Word buttons */
      document.querySelectorAll('.play-word').forEach(function (playBtn) {
        playBtn.addEventListener('click', function () {
          if (playBtn.classList.contains('playing')) { stopAll(); return; }
          stopAll();
          markPlaying(playBtn, true);

          var card        = playBtn.closest('.word-card');
          var wordAudioEl = pickAudio(card, '.audio-word', '');

          function done() { markPlaying(playBtn, false); }

          if (wordAudioEl && wordAudioEl.src) {
            playAudioEl(wordAudioEl, done);
          } else {
            speak(playBtn.dataset.word, done);
          }
        });
      });

      /* Example buttons */
      document.querySelectorAll('.play-ex').forEach(function (playBtn) {
        playBtn.addEventListener('click', function () {
          if (playBtn.classList.contains('playing')) { stopAll(); return; }
          stopAll();
          markPlaying(playBtn, true);

          var text      = playBtn.dataset.text;
          var idx       = playBtn.dataset.index;
          var card      = playBtn.closest('.word-card');
          var exAudioEl = pickAudio(card, '.audio-ex', '[data-index="' + idx + '"]');

          function done() { markPlaying(playBtn, false); }

          if (exAudioEl && exAudioEl.src) {
            playAudioEl(exAudioEl, done);
          } else {
            speak(text, done);
          }
        });
      });

      /* Backup text buttons — open a saved copy in a new tab, for when the
         source link above is dead. Built client-side so no extra files are
         needed; works offline too since nothing is fetched. */
      function escapeHtmlForBackup(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      document.querySelectorAll('.backup-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var win = window.open('', '_blank');
          if (!win) return;
          var text = escapeHtmlForBackup(btn.dataset.articleText || '');
          var src  = escapeHtmlForBackup(btn.dataset.sourceUrl || '');
          win.document.write(
            '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
            '<title>Saved article text</title><style>' +
            'body{font-family:"Hiragino Sans","Yu Gothic",sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;line-height:1.9;white-space:pre-wrap;color:#212529;}' +
            '.note{color:#6c757d;font-size:.85rem;border-bottom:1px solid #dee2e6;padding-bottom:1rem;margin-bottom:1rem;white-space:normal;}' +
            'a{color:#5c6bc0;}' +
            '</style></head><body>' +
            '<p class="note">Saved copy — the original article may no longer be available.<br>Original: <a href="' + src + '" target="_blank" rel="noopener">' + src + '</a></p>' +
            text +
            '</body></html>'
          );
          win.document.close();
        });
      });

      /* Furigana tap-to-reveal on touch devices: the first tap on a
         gloss/source link with furigana just reveals the tooltip (via
         .tap-active) instead of navigating; a second tap on the same word
         follows the link. Mobile browsers apply a sticky :hover on tap, so
         :hover can't tell touch from mouse; use the pointerType of the
         pointerdown that started the click instead. Mouse clicks, keyboard
         activation (click.detail is 0), and links with no furigana (e.g.
         kana-only targets) all navigate on the first click. */
      var lastPointerType = '';
      document.addEventListener('pointerdown', function (e) { lastPointerType = e.pointerType; }, true);
      document.querySelectorAll('.example a.gloss-link, .example a.source-link').forEach(function (link) {
        link.addEventListener('click', function (e) {
          if (e.detail === 0 || lastPointerType !== 'touch' || !link.querySelector('ruby')) return;
          if (link.classList.contains('tap-active')) return;
          e.preventDefault();
          document.querySelectorAll('.tap-active').forEach(function (el) { el.classList.remove('tap-active'); });
          link.classList.add('tap-active');
        });
      });
      document.addEventListener('click', function (e) {
        document.querySelectorAll('.tap-active').forEach(function (el) {
          if (!el.contains(e.target)) el.classList.remove('tap-active');
        });
      });

    })();
  </script>
</body>
</html>`;
}

export function writeHtmlOutput(
  records: WordRecord[],
  date: string,
  outputDir: string,
  reviewRecord: WordRecord | null = null
): string {
  const html = buildPage(records, date, reviewRecord);
  const filename = `digest-${date}.html`;
  const outPath = resolveOutputPath(outputDir, filename);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`[output] HTML → ${outPath}`);
  return outPath;
}
