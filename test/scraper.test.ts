import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractArchivalText, scrapeArticleText } from '../src/scraper';
import { captureConsole, mockFetch, startServer, textResponse, type Captured, type TestServer } from './helpers';

let con: Captured;
let server: TestServer | undefined;
beforeEach(() => { con = captureConsole(); });
afterEach(async () => { con.restore(); await server?.close(); server = undefined; });

// Each is over 100 characters, the least text a content selector must hold to be chosen.
const P1 = 'これは最初の段落です。' + 'とても長い文章になっています。'.repeat(7);
const P2 = 'これは二番目の段落です。' + 'もう少し文章を書いておきます。'.repeat(7);
const page = (body: string) => `<html><head><title>t</title></head><body>${body}</body></html>`;

async function scrape(html: string) {
  server = await startServer({ '/a': html });
  return scrapeArticleText(`${server.url}/a`);
}

describe('scrapeArticleText: choosing the content', () => {
  it('extracts paragraphs from <article>, one segment per block', async () => {
    const r = await scrape(page(`<article><p>${P1}</p><p>${P2}</p></article>`));
    assert.equal(r.text, `${P1}\n\n${P2}`);
  });

  it('keeps headings and list items in the text', async () => {
    const r = await scrape(page(`<article><h1>見出しがここに入ります</h1><p>${P1}</p><ul><li>リストの項目がここにあります</li></ul></article>`));
    assert.equal(r.text, `見出しがここに入ります\n\n${P1}\n\nリストの項目がここにあります`);
  });

  it('prefers <article> over <main>', async () => {
    const r = await scrape(page(`<main><p>メインの本文が入っています。十分に長い文章です。</p></main><article><p>${P1}</p></article>`));
    assert.match(r.text, /最初の段落/);
    assert.ok(!r.text.includes('メインの本文'));
  });

  const selectors: Array<[string, string]> = [
    ['[class*="article-body"]', '<div class="article-body-x">'],
    ['[class*="story-body"]', '<div class="story-body">'],
    ['[class*="post-content"]', '<div class="post-content">'],
    ['[class*="entry-content"]', '<div class="entry-content">'],
    ['main', '<main>'],
    ['.content', '<div class="content">'],
    ['#content', '<div id="content">'],
  ];
  for (const [name, open] of selectors) {
    it(`finds content by ${name}`, async () => {
      const close = open.startsWith('<main') ? '</main>' : '</div>';
      const r = await scrape(page(`<p>ページ外の段落です。これは対象外の文章になります。</p>${open}<p>${P1}</p><p>${P2}</p>${close}`));
      assert.equal(r.text, `${P1}\n\n${P2}`);
    });
  }

  it('moves on when a selector matches too little text', async () => {
    const r = await scrape(page(`<article><p>短い</p></article><main><p>${P1}</p><p>${P2}</p></main>`));
    assert.equal(r.text, `${P1}\n\n${P2}`);
  });

  it('falls back to the whole body', async () => {
    const r = await scrape(page(`<p>${P1}</p><p>${P2}</p>`));
    assert.equal(r.text, `${P1}\n\n${P2}`);
  });

  it('falls back to the container text when it has no block elements', async () => {
    const text = 'ブロック要素を持たない、ただのテキストだけの本文になっています。'.repeat(3);
    const r = await scrape(page(`<article>${text}</article>`));
    assert.equal(r.text, text);
  });
});

describe('scrapeArticleText: cleaning', () => {
  it('drops navigation, headers, footers, asides, ads and scripts', async () => {
    const r = await scrape(page(`
      <header><p>ヘッダーの文章がここに入ります。</p></header>
      <nav><p>ナビゲーションの文章がここに入ります。</p></nav>
      <article>
        <p>${P1}</p>
        <aside><p>サイドバーの文章がここに入ります。</p></aside>
        <div class="advertisement"><p>広告の文章がここに入ります。</p></div>
        <div class="ad"><p>広告その二の文章がここに入ります。</p></div>
        <div class="main-menu"><p>メニューの文章がここに入ります。</p></div>
        <div class="sitenav-x"><p>別のナビの文章がここに入ります。</p></div>
        <script>document.write("スクリプトの文章がここに入ります。")</script>
        <style>p { color: red }</style>
        <p>${P2}</p>
      </article>
      <footer><p>フッターの文章がここに入ります。</p></footer>`));
    assert.equal(r.text, `${P1}\n\n${P2}`);
  });

  it('skips blocks under 10 characters', async () => {
    const r = await scrape(page(`<article><p>${P1}</p><p>短い段落</p><p>${P2}</p></article>`));
    assert.equal(r.text, `${P1}\n\n${P2}`);
  });

  it('collects an outer block once, not its nested blocks', async () => {
    const r = await scrape(page(`<article><blockquote><p>${P1}</p></blockquote><p>${P2}</p></article>`));
    assert.equal(r.text, `${P1}\n\n${P2}`);
  });

  it('normalises full-width spaces, tabs and blank lines', async () => {
    const r = await scrape(page(`<article><p>これは　　全角の\t空白を含む段落です。</p><p>${P2}</p></article>`));
    assert.equal(r.text, `これは 全角の 空白を含む段落です。\n\n${P2}`);
  });

  it('reads furigana as part of the text', async () => {
    // The scraper does not strip <rt>; only the feed path (stripHtml / extractArchivalText) does.
    const r = await scrape(page(`<article><p>これは<ruby>漢字<rt>かんじ</rt></ruby>を含む段落です。十分な長さです。</p></article>`));
    assert.match(r.text, /漢字かんじ/);
  });
});

describe('scrapeArticleText: archival text', () => {
  it('holds only prose, without headings or list items', async () => {
    const r = await scrape(page(`<article><h1>見出しがここに入ります</h1><p>${P1}</p><ul><li>リストの項目がここにあります</li></ul><p>${P2}</p></article>`));
    assert.equal(r.archivalText, `${P1}\n\n${P2}`);
  });

  it('includes blockquotes and definition lists', async () => {
    const r = await scrape(page(`<article><blockquote>${P1}</blockquote><dl><dt>用語の名前です。</dt><dd>${P2}</dd></dl></article>`));
    assert.match(r.archivalText, /最初の段落/);
    assert.match(r.archivalText, /二番目の段落/);
  });

  it('is capped at 5000 characters, while text is not', async () => {
    const paragraphs = Array.from({ length: 400 }, (_, i) => `<p>${String(i).padStart(3, '0')}番目の段落の文章です。長い記事の一部分になります。</p>`).join('');
    const r = await scrape(page(`<article>${paragraphs}</article>`));
    assert.equal(r.archivalText.length, 5000);
    assert.ok(r.text.length > 5000);
  });

  // Known bug, kept as a todo so it shows up in the report without failing the suite: the
  // "already inside a block" check looks at every ancestor in the page, not just those inside
  // the article. Since the archival selector includes <div>, an article inside any wrapper
  // <div> loses the segmentation: headings and lists leak in and paragraphs join with one \n.
  it('excludes headings and lists even when the article sits inside a wrapper div', { todo: 'extractBlockTexts checks ancestors outside the container' }, async () => {
    const r = await scrape(page(`<div class="page"><article><h1>見出しがここに入ります</h1><p>${P1}</p><ul><li>リストの項目がここにあります</li></ul><p>${P2}</p></article></div>`));
    assert.equal(r.archivalText, `${P1}\n\n${P2}`);
  });
});

describe('scrapeArticleText: failures', () => {
  it('returns empty text, with a warning, on an HTTP error', async () => {
    server = await startServer({ '/a': [404, 'gone'] });
    assert.deepEqual(await scrapeArticleText(`${server.url}/a`), { text: '', archivalText: '' });
    assert.match(con.warn.join('\n'), /HTTP 404/);
  });

  it('returns empty text, with a warning, on a network error', async () => {
    const m = mockFetch(() => { throw new Error('ETIMEDOUT'); });
    try {
      assert.deepEqual(await scrapeArticleText('http://down.test/a'), { text: '', archivalText: '' });
    } finally { m.restore(); }
    assert.match(con.warn.join('\n'), /Failed to fetch http:\/\/down\.test\/a: ETIMEDOUT/);
  });

  it('sends a User-Agent and prefers Japanese', async () => {
    const m = mockFetch(() => textResponse(page(`<article><p>${P1}</p></article>`)));
    try {
      await scrapeArticleText('http://x.test/a');
    } finally { m.restore(); }
    const headers = m.calls[0].init?.headers as Record<string, string>;
    assert.match(headers['User-Agent'], /KotobaNoSekai/);
    assert.match(headers['Accept-Language'], /^ja/);
    assert.ok(m.calls[0].init?.signal);
  });

  it('copes with an empty document', async () => {
    assert.deepEqual(await scrape(''), { text: '', archivalText: '' });
  });
});

describe('extractArchivalText', () => {
  it('extracts paragraphs from a fragment', () => {
    assert.equal(extractArchivalText(`<p>${P1}</p><p>${P2}</p>`), `${P1}\n\n${P2}`);
  });

  it('drops headings, list items and short blocks', () => {
    assert.equal(extractArchivalText(`<h2>見出しがここに入ります</h2><p>${P1}</p><ul><li>リストの項目がここにあります</li></ul><p>短い</p>`), P1);
  });

  it('removes furigana readings', () => {
    const out = extractArchivalText('<p>これは<ruby>漢字<rt>かんじ</rt></ruby>を含む段落です。十分な長さです。</p>');
    assert.equal(out, 'これは漢字を含む段落です。十分な長さです。');
  });

  it('removes scripts and styles', () => {
    const out = extractArchivalText(`<p>${P1}</p><script>alert("スクリプトの文章がここにあります")</script><style>p{}</style>`);
    assert.equal(out, P1);
  });

  it('uses an outer div as one segment', () => {
    assert.equal(extractArchivalText(`<div><p>${P1}</p><p>${P2}</p></div>`).replace(/\s+/g, ''), (P1 + P2).replace(/\s+/g, ''));
  });

  it('falls back to the whole text when there are no blocks', () => {
    assert.equal(extractArchivalText('ブロックのない、ただのテキストの本文です。'), 'ブロックのない、ただのテキストの本文です。');
  });

  it('caps the length at 5000', () => {
    const html = Array.from({ length: 300 }, () => `<p>${P1}</p>`).join('');
    assert.equal(extractArchivalText(html).length, 5000);
  });

  it('handles empty input', () => {
    assert.equal(extractArchivalText(''), '');
  });
});
