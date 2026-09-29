import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRssFeedArticles, listRssFeedItems, parseDate, shuffle, stripHtml } from '../src/rss';
import type { FeedSource } from '../src/types';
import { captureConsole, startServer, type Captured, type TestServer } from './helpers';

let con: Captured;
let server: TestServer | undefined;
beforeEach(() => { con = captureConsole(); });
afterEach(async () => { con.restore(); mock.restoreAll(); await server?.close(); server = undefined; });

describe('stripHtml', () => {
  it('removes tags', () => {
    assert.equal(stripHtml('<span>今日</span>は<b>晴れ</b>'), '今日 は 晴れ');
  });

  it('turns block tags into paragraph breaks', () => {
    for (const tag of ['p', 'div', 'article', 'section', 'h1', 'h2', 'li', 'ul', 'ol', 'blockquote', 'table', 'tr', 'td', 'th', 'dt', 'dd', 'pre']) {
      assert.equal(stripHtml(`<${tag}>一つ目</${tag}><${tag}>二つ目</${tag}>`), '一つ目\n\n二つ目', tag);
    }
  });

  it('ignores attributes on block tags', () => {
    assert.equal(stripHtml('<p class="a" id="b">一</p><P>二</P>'), '一\n\n二');
  });

  it('removes script and style contents', () => {
    assert.equal(stripHtml('<p>本文</p><script>var x = "<p>no</p>";</script><style>p{color:red}</style>'), '本文');
    assert.equal(stripHtml('<SCRIPT type="x">alert(1)</SCRIPT>本文'), '本文');
  });

  it('drops furigana readings and unwraps ruby without adding spaces', () => {
    assert.equal(stripHtml('<ruby>鹿児島県<rt>かごしまけん</rt></ruby>で'), '鹿児島県で');
    assert.equal(stripHtml('<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>'), '漢字');
  });

  it('decodes the common entities', () => {
    assert.equal(stripHtml('A&nbsp;B &amp; C &lt;D&gt; &quot;E&quot; &#39;F&#39;'), "A B & C <D> \"E\" 'F'");
  });

  it('collapses runs of spaces and tabs, and runs of blank lines', () => {
    assert.equal(stripHtml('a \t  b'), 'a b');
    assert.equal(stripHtml('<p>a</p><p></p><p></p><p>b</p>'), 'a\n\nb');
  });

  it('trims', () => {
    assert.equal(stripHtml('  <p> 一 </p>  '), '一');
  });

  it('handles empty input', () => {
    assert.equal(stripHtml(''), '');
    assert.equal(stripHtml('<div></div>'), '');
  });
});

describe('parseDate', () => {
  it('parses ISO and RFC 822 dates to epoch ms', () => {
    assert.equal(parseDate('2026-09-01T00:00:00Z'), Date.UTC(2026, 8, 1));
    assert.equal(parseDate('Tue, 01 Sep 2026 00:00:00 GMT'), Date.UTC(2026, 8, 1));
  });

  it('returns 0 for missing or unparseable values', () => {
    assert.equal(parseDate(undefined), 0);
    assert.equal(parseDate(''), 0);
    assert.equal(parseDate('not a date'), 0);
  });
});

describe('shuffle', () => {
  it('shuffles in place and returns the same array', () => {
    const arr = [1, 2, 3, 4, 5];
    assert.equal(shuffle(arr), arr);
    assert.deepEqual([...arr].sort(), [1, 2, 3, 4, 5]);
  });

  it('follows Fisher-Yates for a fixed random source', () => {
    mock.method(Math, 'random', () => 0);
    assert.deepEqual(shuffle(['a', 'b', 'c', 'd']), ['b', 'c', 'd', 'a']);
  });

  it('can produce every permutation of three items', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(shuffle([1, 2, 3]).join(''));
    assert.equal(seen.size, 6);
  });

  it('handles empty and single-item arrays', () => {
    assert.deepEqual(shuffle([]), []);
    assert.deepEqual(shuffle([1]), [1]);
  });
});

// ── Feeds served from a local server ──────────────────────

const LONG = '<p>' + 'これはフィードに埋め込まれた記事の本文です。'.repeat(12) + '</p>';
const rss = (items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Test</title>${items}</channel></rss>`;
const item = (o: { title?: string; link?: string; date?: string; description?: string; encoded?: string }) => `<item>
${o.title !== undefined ? `<title>${o.title}</title>` : ''}
${o.link !== undefined ? `<link>${o.link}</link>` : ''}
${o.date ? `<pubDate>${o.date}</pubDate>` : ''}
${o.description !== undefined ? `<description><![CDATA[${o.description}]]></description>` : ''}
${o.encoded !== undefined ? `<content:encoded><![CDATA[${o.encoded}]]></content:encoded>` : ''}
</item>`;
const ARTICLE_PAGE = `<html><body><article><p>${'スクレイピングで取得した記事の本文です。'.repeat(10)}</p></article></body></html>`;

const source = (url: string, over: Partial<FeedSource> = {}): FeedSource => ({ url, domain: 'news', name: 'Test Feed', enabled: true, ...over });

describe('fetchRssFeedArticles', () => {
  it('uses inline content-encoded HTML without visiting the article', async () => {
    server = await startServer({
      '/feed.xml': base => rss(item({ title: '見出し', link: `${base}/a`, encoded: LONG })),
      '/a': ARTICLE_PAGE,
    });
    const [a, ...rest] = await fetchRssFeedArticles(source(`${server.url}/feed.xml`));
    assert.equal(rest.length, 0);
    assert.equal(a.title, '見出し');
    assert.equal(a.url, `${server.url}/a`);
    assert.equal(a.domain, 'news');
    assert.match(a.text, /^これはフィードに埋め込まれた/);
    assert.ok(!a.text.includes('<p>'));
    assert.match(a.archivalText, /これはフィードに埋め込まれた/);
    assert.ok(!server.hits.includes('/a'), 'article page was not fetched');
  });

  it('falls back to the description when it is long enough', async () => {
    server = await startServer({ '/feed.xml': base => rss(item({ title: 't', link: `${base}/a`, description: LONG })), '/a': ARTICLE_PAGE });
    const [a] = await fetchRssFeedArticles(source(`${server.url}/feed.xml`));
    assert.match(a.text, /フィードに埋め込まれた/);
    assert.ok(!server.hits.includes('/a'));
  });

  it('prefers content:encoded over the description', async () => {
    const other = '<p>' + '別の説明文です。'.repeat(40) + '</p>';
    server = await startServer({ '/feed.xml': base => rss(item({ link: `${base}/a`, description: other, encoded: LONG })) });
    const [a] = await fetchRssFeedArticles(source(`${server.url}/feed.xml`));
    assert.match(a.text, /フィードに埋め込まれた/);
    assert.ok(!a.text.includes('別の説明文'));
  });

  it('scrapes the article page when the inline content is short', async () => {
    server = await startServer({
      '/feed.xml': base => rss(item({ title: 't', link: `${base}/a`, description: '短い要約' })),
      '/a': ARTICLE_PAGE,
    });
    const [a] = await fetchRssFeedArticles(source(`${server.url}/feed.xml`));
    assert.match(a.text, /スクレイピングで取得した/);
    assert.ok(server.hits.includes('/a'));
  });

  it('skips items with no link, and items whose text is too short', async () => {
    server = await startServer({
      '/feed.xml': base => rss([
        item({ title: 'no link', encoded: LONG }),
        item({ title: 'short', link: `${base}/short`, description: '短い' }),
        item({ title: 'ok', link: `${base}/ok`, encoded: LONG }),
      ].join('')),
      '/short': '<html><body><p>短い</p></body></html>',
    });
    const articles = await fetchRssFeedArticles(source(`${server.url}/feed.xml`));
    assert.deepEqual(articles.map(a => a.title), ['ok']);
  });

  it('defaults a missing title to an empty string', async () => {
    server = await startServer({ '/feed.xml': base => rss(item({ link: `${base}/a`, encoded: LONG })) });
    const [a] = await fetchRssFeedArticles(source(`${server.url}/feed.xml`));
    assert.equal(a.title, '');
  });

  it('returns nothing, with a warning, when the feed is unreachable', async () => {
    server = await startServer({});
    assert.deepEqual(await fetchRssFeedArticles(source(`${server.url}/missing.xml`)), []);
    assert.match(con.warn.join('\n'), /\[rss\] Failed to fetch Test Feed/);
  });

  it('returns nothing, with a warning, when the feed is not XML', async () => {
    server = await startServer({ '/feed.xml': 'this is not xml' });
    assert.deepEqual(await fetchRssFeedArticles(source(`${server.url}/feed.xml`)), []);
    assert.match(con.warn.join('\n'), /Failed to fetch/);
  });

  it('returns an empty list for an empty feed', async () => {
    server = await startServer({ '/feed.xml': rss('') });
    assert.deepEqual(await fetchRssFeedArticles(source(`${server.url}/feed.xml`)), []);
  });
});

describe('listRssFeedItems', () => {
  it('lists stubs without fetching any article', async () => {
    server = await startServer({
      '/feed.xml': base => rss([
        item({ title: 'A', link: `${base}/a`, date: 'Tue, 01 Sep 2026 00:00:00 GMT', encoded: LONG }),
        item({ title: 'B', link: `${base}/b`, description: '短い要約' }),
      ].join('')),
    });
    const stubs = await listRssFeedItems(source(`${server.url}/feed.xml`, { name: 'My Feed', domain: 'sci' }));
    assert.equal(stubs.length, 2);
    assert.deepEqual(server.hits, ['/feed.xml']);

    assert.equal(stubs[0].url, `${server.url}/a`);
    assert.equal(stubs[0].title, 'A');
    assert.equal(stubs[0].feedName, 'My Feed');
    assert.equal(stubs[0].domain, 'sci');
    assert.equal(stubs[0].publishedAt, Date.UTC(2026, 8, 1));
    assert.equal(stubs[0].inlineText, LONG);
    assert.equal(stubs[1].publishedAt, 0, 'no date');
    assert.equal(stubs[1].inlineText, '短い要約');
  });

  it('skips items without a link', async () => {
    server = await startServer({ '/feed.xml': base => rss(item({ title: 'x' }) + item({ title: 'y', link: `${base}/y` })) });
    const stubs = await listRssFeedItems(source(`${server.url}/feed.xml`));
    assert.deepEqual(stubs.map(s => s.title), ['y']);
  });

  it('returns nothing, with a warning, on failure', async () => {
    server = await startServer({ '/feed.xml': [500, 'oops'] });
    assert.deepEqual(await listRssFeedItems(source(`${server.url}/feed.xml`)), []);
    assert.match(con.warn.join('\n'), /Failed to fetch/);
  });
});
