import RSSParser from 'rss-parser';
import type { FeedSource, ArticleContent } from './types.js';
import { scrapeArticleText } from './scraper.js';

type FeedItem = {
  title?: string;
  link?: string;
  contentEncoded?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
};

const parser = new RSSParser<Record<string, unknown>, FeedItem>({
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  },
  timeout: 15000,
});

/** Shuffle an array in-place (Fisher-Yates). */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Fetch all articles from a single feed and return them as ArticleContent.
 * Falls back gracefully: tries contentEncoded → content → description,
 * then optionally fetches the full article page.
 */
export async function fetchFeedArticles(source: FeedSource): Promise<ArticleContent[]> {
  console.log(`[rss] Fetching ${source.name} (${source.url})`);

  let feed: Awaited<ReturnType<typeof parser.parseURL>>;
  try {
    feed = await parser.parseURL(source.url);
  } catch (err) {
    console.warn(`[rss] Failed to fetch ${source.name}: ${(err as Error).message}`);
    return [];
  }

  const articles: ArticleContent[] = [];

  for (const item of feed.items ?? []) {
    const url = item.link ?? '';
    if (!url) continue;

    // Prefer full article HTML embedded in the feed
    const inlineHtml = item.contentEncoded ?? item.content ?? '';
    let text = '';

    if (inlineHtml.length > 200) {
      text = stripHtml(inlineHtml);
    } else {
      // Fetch the actual article page
      text = await scrapeArticleText(url);
    }

    if (text.trim().length < 50) continue;

    articles.push({
      url,
      title: item.title ?? '',
      domain: source.domain,
      text,
    });
  }

  console.log(`[rss] ${source.name}: ${articles.length} articles`);
  return articles;
}

/** Strip HTML tags and decode common entities. */
export function stripHtml(html: string): string {
  // Block-level tags become paragraph breaks so sentences don't cross block boundaries
  const BLOCK_TAG_RE = /<\/?(p|div|article|section|h[1-6]|li|ul|ol|blockquote|table|tr|td|th|dt|dd|pre)[^>]*>/gi;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(BLOCK_TAG_RE, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
