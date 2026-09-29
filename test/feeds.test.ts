import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeedArticles, listFeedItems, resolveArticleText } from '../src/feeds';
import * as feeds from '../src/feeds';
import * as rss from '../src/rss';
import type { ArticleStub, FeedSource } from '../src/types';
import { captureConsole, startServer, type Captured, type TestServer } from './helpers';

let con: Captured;
let server: TestServer | undefined;
beforeEach(() => { con = captureConsole(); });
afterEach(async () => { con.restore(); await server?.close(); server = undefined; });

const LONG = '<p>' + 'フィードの本文がここに入ります。'.repeat(20) + '</p>';
const PAGE = `<html><body><article><p>${'ページから取得した本文になります。'.repeat(10)}</p></article></body></html>`;
const RSS = (link: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
  <item><title>RSS item</title><link>${link}</link><description><![CDATA[${LONG}]]></description></item></channel></rss>`;

const src = (over: Partial<FeedSource>): FeedSource => ({ url: '', domain: 'd', name: 'F', enabled: true, ...over });
const stub = (over: Partial<ArticleStub> = {}): ArticleStub => ({ url: 'http://x', title: 't', domain: 'd', feedName: 'F', publishedAt: 0, ...over });

describe('re-exports', () => {
  it('exposes shuffle and stripHtml from rss', () => {
    assert.equal(feeds.shuffle, rss.shuffle);
    assert.equal(feeds.stripHtml, rss.stripHtml);
  });
});

describe('fetchFeedArticles / listFeedItems dispatch', () => {
  const setup = async () => {
    server = await startServer({
      '/rss.xml': base => RSS(`${base}/a`),
      '/feed.json': [200, JSON.stringify([{ url: 'https://json.example/a', body: LONG }]), 'application/json'],
    });
    return server.url;
  };

  it('uses the RSS parser when type is omitted or "rss"', async () => {
    const base = await setup();
    for (const type of [undefined, 'rss' as const]) {
      const articles = await fetchFeedArticles(src({ url: `${base}/rss.xml`, type }));
      assert.deepEqual(articles.map(a => a.title), ['RSS item']);
      const stubs = await listFeedItems(src({ url: `${base}/rss.xml`, type }));
      assert.deepEqual(stubs.map(s => s.title), ['RSS item']);
    }
  });

  it('uses the JSON parser when type is "json"', async () => {
    const base = await setup();
    const json = { urlField: 'url', contentField: 'body' };
    const articles = await fetchFeedArticles(src({ url: `${base}/feed.json`, type: 'json', json }));
    assert.deepEqual(articles.map(a => a.url), ['https://json.example/a']);
    const stubs = await listFeedItems(src({ url: `${base}/feed.json`, type: 'json', json }));
    assert.deepEqual(stubs.map(s => s.url), ['https://json.example/a']);
  });

  it('skips an unknown type with a warning', async () => {
    const bad = src({ name: 'Weird', type: 'atom' as never });
    assert.deepEqual(await fetchFeedArticles(bad), []);
    assert.deepEqual(await listFeedItems(bad), []);
    assert.equal(con.warn.filter(w => /unknown feed type "atom", skipping/.test(w)).length, 2);
  });
});

describe('resolveArticleText', () => {
  it('uses inline text when it is longer than 200 characters', async () => {
    const inline = '<div><p>本文の一段落目です。</p>' + '<p>' + 'あ'.repeat(200) + '</p></div>';
    assert.ok(inline.length > 200);
    const r = await resolveArticleText(stub({ url: 'http://unreachable.invalid/', inlineText: inline }));
    assert.match(r.text, /^本文の一段落目です。/);
    assert.ok(!r.text.includes('<'));
    assert.ok(r.archivalText.length > 0);
  });

  it('scrapes the page when the inline text is 200 characters or fewer', async () => {
    server = await startServer({ '/a': PAGE });
    const inline = 'あ'.repeat(200);
    const r = await resolveArticleText(stub({ url: `${server.url}/a`, inlineText: inline }));
    assert.match(r.text, /ページから取得した/);
    assert.deepEqual(server.hits, ['/a']);
  });

  it('scrapes the page when there is no inline text', async () => {
    server = await startServer({ '/a': PAGE });
    const r = await resolveArticleText(stub({ url: `${server.url}/a` }));
    assert.match(r.text, /ページから取得した/);
  });

  it('returns empty text when the page cannot be fetched', async () => {
    server = await startServer({});
    assert.deepEqual(await resolveArticleText(stub({ url: `${server.url}/missing` })), { text: '', archivalText: '' });
  });
});
