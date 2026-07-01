import type { FeedSource, ArticleContent, ArticleStub } from './types.js';
import { scrapeArticleText } from './scraper.js';
import { stripHtml, parseDate } from './rss.js';

/** Resolve a dot-notation path (e.g. "data.items") against a JSON value. */
function getPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

function readStringField(item: Record<string, unknown>, path: string): string {
  const value = getPath(item, path);
  return typeof value === 'string' ? value : '';
}

/** Fetch a JSON feed and resolve its mapped item array, or null on failure. */
async function fetchJsonItems(source: FeedSource): Promise<Record<string, unknown>[] | null> {
  const mapping = source.json;
  if (!mapping) {
    console.warn(`[json-feed] ${source.name}: type is "json" but no "json" mapping is configured, skipping`);
    return null;
  }

  let data: unknown;
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KotobaNoSekai/1.0; +https://github.com/kotoba-no-sekai)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[json-feed] HTTP ${res.status} for ${source.url}`);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn(`[json-feed] Failed to fetch ${source.name}: ${(err as Error).message}`);
    return null;
  }

  const items = getPath(data, mapping.itemsPath);
  if (!Array.isArray(items)) {
    console.warn(`[json-feed] ${source.name}: expected an array at "${mapping.itemsPath ?? '(response root)'}"`);
    return null;
  }

  return items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
}

/**
 * Fetch articles from a JSON API endpoint, using the source's `json` mapping to
 * locate the item list and the URL/title/content fields within each item.
 * Falls back to scraping the article page when no inline content field is mapped
 * or the inline content is too short, mirroring fetchRssFeedArticles in rss.ts.
 */
export async function fetchJsonFeedArticles(source: FeedSource): Promise<ArticleContent[]> {
  console.log(`[json-feed] Fetching ${source.name} (${source.url})`);

  const items = await fetchJsonItems(source);
  if (!items) return [];
  const mapping = source.json!;

  const articles: ArticleContent[] = [];

  for (const record of items) {
    const url = readStringField(record, mapping.urlField);
    if (!url) continue;

    const title = mapping.titleField ? readStringField(record, mapping.titleField) : '';
    const inline = mapping.contentField ? readStringField(record, mapping.contentField) : '';

    const text = inline.length > 200 ? stripHtml(inline) : await scrapeArticleText(url);
    if (text.trim().length < 50) continue;

    articles.push({ url, title, domain: source.domain, text });
  }

  console.log(`[json-feed] ${source.name}: ${articles.length} articles`);
  return articles;
}

/**
 * List articles from a JSON feed as lightweight stubs, without fetching full
 * article text. Lets the caller sort/select by date and feed before scraping.
 */
export async function listJsonFeedItems(source: FeedSource): Promise<ArticleStub[]> {
  console.log(`[json-feed] Listing ${source.name} (${source.url})`);

  const items = await fetchJsonItems(source);
  if (!items) return [];
  const mapping = source.json!;

  const stubs: ArticleStub[] = [];

  for (const record of items) {
    const url = readStringField(record, mapping.urlField);
    if (!url) continue;

    stubs.push({
      url,
      title: mapping.titleField ? readStringField(record, mapping.titleField) : '',
      domain: source.domain,
      feedName: source.name,
      publishedAt: mapping.dateField ? parseDate(readStringField(record, mapping.dateField)) : 0,
      inlineText: mapping.contentField ? readStringField(record, mapping.contentField) || undefined : undefined,
    });
  }

  console.log(`[json-feed] ${source.name}: ${stubs.length} articles`);
  return stubs;
}
