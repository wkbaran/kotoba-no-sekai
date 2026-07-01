import type { FeedSource, ArticleContent, ArticleStub } from './types.js';
import { fetchRssFeedArticles, listRssFeedItems, stripHtml } from './rss.js';
import { fetchJsonFeedArticles, listJsonFeedItems } from './json-feed.js';
import { scrapeArticleText } from './scraper.js';

export { shuffle, stripHtml } from './rss.js';

/** Fetch articles from a feed source, dispatching to the RSS or JSON parser by source.type. */
export async function fetchFeedArticles(source: FeedSource): Promise<ArticleContent[]> {
  switch (source.type) {
    case 'json':
      return fetchJsonFeedArticles(source);
    case 'rss':
    case undefined:
      return fetchRssFeedArticles(source);
    default:
      console.warn(`[feeds] ${source.name}: unknown feed type "${source.type}", skipping`);
      return [];
  }
}

/** List article stubs (metadata only, no scraping) from a feed source. */
export async function listFeedItems(source: FeedSource): Promise<ArticleStub[]> {
  switch (source.type) {
    case 'json':
      return listJsonFeedItems(source);
    case 'rss':
    case undefined:
      return listRssFeedItems(source);
    default:
      console.warn(`[feeds] ${source.name}: unknown feed type "${source.type}", skipping`);
      return [];
  }
}

/**
 * Resolve an article stub's full text: use the feed's inline content when long
 * enough, otherwise scrape the article page. Mirrors fetchRssFeedArticles's
 * inline-vs-scrape threshold, just deferred until the stub is actually needed.
 */
export async function resolveArticleText(stub: ArticleStub): Promise<string> {
  if (stub.inlineText && stub.inlineText.length > 200) {
    return stripHtml(stub.inlineText);
  }
  return scrapeArticleText(stub.url);
}
