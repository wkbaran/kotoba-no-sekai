import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJsonFeedArticles, listJsonFeedItems } from '../src/json-feed';
import type { FeedSource, JsonFeedMapping } from '../src/types';
import { captureConsole, mockFetch, startServer, textResponse, jsonResponse, type Captured, type TestServer } from './helpers';

let con: Captured;
let server: TestServer | undefined;
beforeEach(() => { con = captureConsole(); });
afterEach(async () => { con.restore(); await server?.close(); server = undefined; });

const LONG_HTML = '<p>' + 'JSONフィードに埋め込まれた記事の本文です。'.repeat(12) + '</p>';
const PAGE = `<html><body><article><p>${'ページから取得した記事の本文になります。'.repeat(10)}</p></article></body></html>`;

const source = (url: string, json: JsonFeedMapping | undefined, over: Partial<FeedSource> = {}): FeedSource =>
  ({ url, domain: 'news', name: 'JSON Feed', enabled: true, type: 'json', json, ...over });

const serve = (data: unknown, path = '/feed.json') => startServer({
  [path]: [200, JSON.stringify(data), 'application/json'],
  '/page': PAGE,
});

describe('fetchJsonFeedArticles', () => {
  it('reads items at a nested path with nested field paths', async () => {
    server = await serve({ data: { items: [{ link: { href: 'https://example.com/a' }, meta: { title: '見出し' }, body: LONG_HTML }] } });
    const articles = await fetchJsonFeedArticles(source(`${server.url}/feed.json`, {
      itemsPath: 'data.items', urlField: 'link.href', titleField: 'meta.title', contentField: 'body',
    }));
    assert.equal(articles.length, 1);
    assert.equal(articles[0].url, 'https://example.com/a');
    assert.equal(articles[0].title, '見出し');
    assert.equal(articles[0].domain, 'news');
    assert.match(articles[0].text, /^JSONフィードに埋め込まれた/);
    assert.match(articles[0].archivalText, /JSONフィードに埋め込まれた/);
    assert.deepEqual(server.hits, ['/feed.json'], 'inline content means no scrape');
  });

  it('accepts an array at the response root', async () => {
    server = await serve([{ url: 'https://example.com/a', content: LONG_HTML }]);
    const articles = await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { urlField: 'url', contentField: 'content' }));
    assert.equal(articles.length, 1);
    assert.equal(articles[0].title, '', 'no titleField');
  });

  it('scrapes the article page when the content is short, unmapped or missing', async () => {
    server = await startServer({
      '/feed.json': base => [200, JSON.stringify([
        { url: `${base}/page`, content: '短い' },
        { url: `${base}/page` },
      ]), 'application/json'],
      '/page': PAGE,
    });
    const withContent = await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { urlField: 'url', contentField: 'content' }));
    assert.equal(withContent.length, 2);
    assert.match(withContent[0].text, /ページから取得した/);
    assert.equal(server.hits.filter(h => h === '/page').length, 2);

    const noMapping = await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { urlField: 'url' }));
    assert.equal(noMapping.length, 2);
  });

  it('skips items with a missing or non-string url, and non-object items', async () => {
    server = await serve([
      { content: LONG_HTML },
      { url: 42, content: LONG_HTML },
      null, 'text', 7,
      { url: 'https://example.com/ok', content: LONG_HTML },
    ]);
    const articles = await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { urlField: 'url', contentField: 'content' }));
    assert.deepEqual(articles.map(a => a.url), ['https://example.com/ok']);
  });

  it('skips articles whose text is too short', async () => {
    server = await startServer({
      '/feed.json': base => [200, JSON.stringify([{ url: `${base}/tiny` }]), 'application/json'],
      '/tiny': '<html><body><p>短い</p></body></html>',
    });
    assert.deepEqual(await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { urlField: 'url' })), []);
  });

  it('ignores a non-string content field', async () => {
    server = await startServer({
      '/feed.json': base => [200, JSON.stringify([{ url: `${base}/page`, content: { html: LONG_HTML } }]), 'application/json'],
      '/page': PAGE,
    });
    const [a] = await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { urlField: 'url', contentField: 'content' }));
    assert.match(a.text, /ページから取得した/);
  });

  it('warns and returns nothing when the mapping is missing', async () => {
    assert.deepEqual(await fetchJsonFeedArticles(source('http://unused.test/feed', undefined)), []);
    assert.match(con.warn.join('\n'), /no "json" mapping is configured/);
  });

  it('warns and returns nothing on an HTTP error', async () => {
    server = await startServer({ '/feed.json': [503, 'busy'] });
    assert.deepEqual(await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { urlField: 'url' })), []);
    assert.match(con.warn.join('\n'), /HTTP 503/);
  });

  it('warns and returns nothing on invalid JSON', async () => {
    server = await startServer({ '/feed.json': '{oops' });
    assert.deepEqual(await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { urlField: 'url' })), []);
    assert.match(con.warn.join('\n'), /Failed to fetch JSON Feed/);
  });

  it('warns and returns nothing on a network error', async () => {
    const m = mockFetch(() => { throw new Error('ECONNREFUSED'); });
    try {
      assert.deepEqual(await fetchJsonFeedArticles(source('http://down.test/feed', { urlField: 'url' })), []);
    } finally { m.restore(); }
    assert.match(con.warn.join('\n'), /ECONNREFUSED/);
  });

  it('warns and returns nothing when the items path is not an array', async () => {
    server = await serve({ data: { items: 'nope' } });
    assert.deepEqual(await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { itemsPath: 'data.items', urlField: 'url' })), []);
    assert.match(con.warn.join('\n'), /expected an array at "data\.items"/);
  });

  it('names the response root when there is no items path', async () => {
    server = await serve({ not: 'an array' });
    await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { urlField: 'url' }));
    assert.match(con.warn.join('\n'), /\(response root\)/);
  });

  it('warns when the items path does not exist', async () => {
    server = await serve({ other: [] });
    assert.deepEqual(await fetchJsonFeedArticles(source(`${server.url}/feed.json`, { itemsPath: 'data.items', urlField: 'url' })), []);
    assert.match(con.warn.join('\n'), /expected an array/);
  });

  it('requests JSON with an identifying User-Agent', async () => {
    const m = mockFetch(() => jsonResponse([]));
    try {
      await fetchJsonFeedArticles(source('http://feed.test/x', { urlField: 'url' }));
    } finally { m.restore(); }
    const headers = m.calls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Accept, 'application/json');
    assert.match(headers['User-Agent'], /KotobaNoSekai/);
  });
});

describe('listJsonFeedItems', () => {
  const feed = [
    { u: 'https://example.com/a', t: 'A', d: '2026-09-01T00:00:00Z', c: LONG_HTML },
    { u: 'https://example.com/b', t: 'B', d: 'garbage', c: '' },
    { u: 'https://example.com/c' },
    { t: 'no url' },
  ];

  it('lists stubs with dates and inline text, without fetching articles', async () => {
    server = await serve(feed);
    const stubs = await listJsonFeedItems(source(`${server.url}/feed.json`, { urlField: 'u', titleField: 't', dateField: 'd', contentField: 'c' }, { name: 'Mine', domain: 'sci' }));
    assert.equal(stubs.length, 3);
    assert.deepEqual(server.hits, ['/feed.json']);
    assert.deepEqual(stubs[0], {
      url: 'https://example.com/a', title: 'A', domain: 'sci', feedName: 'Mine',
      publishedAt: Date.UTC(2026, 8, 1), inlineText: LONG_HTML,
    });
    assert.equal(stubs[1].publishedAt, 0, 'unparseable date');
    assert.equal(stubs[1].inlineText, undefined, 'empty content is dropped');
    assert.equal(stubs[2].title, '');
    assert.equal(stubs[2].publishedAt, 0);
  });

  it('leaves optional fields empty when they are not mapped', async () => {
    server = await serve(feed);
    const [a] = await listJsonFeedItems(source(`${server.url}/feed.json`, { urlField: 'u' }));
    assert.equal(a.title, '');
    assert.equal(a.publishedAt, 0);
    assert.equal(a.inlineText, undefined);
  });

  it('returns nothing on failure', async () => {
    const m = mockFetch(() => textResponse('nope', 500));
    try {
      assert.deepEqual(await listJsonFeedItems(source('http://feed.test/x', { urlField: 'u' })), []);
    } finally { m.restore(); }
    assert.match(con.warn.join('\n'), /HTTP 500/);
  });
});
