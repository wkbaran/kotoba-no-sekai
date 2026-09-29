import * as cheerio from 'cheerio';

// Block-level elements whose text should be kept as separate segments
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd';

// Narrower selector used for the archived "whole article" backup copy.
// Headings and list items are excluded: they're rarely part of the actual
// article body (titles, related-link lists, nav) and including them would
// make the archive read as disjointed fragments rather than an article.
const ARCHIVAL_BLOCK_SELECTOR = 'p, div, blockquote, dt, dd';

// Safety cap on how much archived text we keep per article.
const MAX_ARCHIVAL_LENGTH = 5000;

export interface ScrapedArticle {
  text: string;
  archivalText: string;
}

/**
 * Fetch an article URL and extract readable body text.
 * Tries common content selectors before falling back to <body>.
 */
export async function scrapeArticleText(url: string): Promise<ScrapedArticle> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KotobaNoSekai/1.0; +https://github.com/kotoba-no-sekai)',
        'Accept-Language': 'ja,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[scraper] HTTP ${res.status} for ${url}`);
      return { text: '', archivalText: '' };
    }

    const html = await res.text();
    return extractText(html);
  } catch (err) {
    console.warn(`[scraper] Failed to fetch ${url}: ${(err as Error).message}`);
    return { text: '', archivalText: '' };
  }
}

function extractText(html: string): ScrapedArticle {
  const $ = cheerio.load(html);

  // Remove noise elements
  $('script, style, nav, header, footer, aside, .ad, .advertisement, [class*="nav"], [class*="menu"]').remove();

  // Try common article content selectors in priority order
  const contentSelectors = [
    'article',
    '[class*="article-body"]',
    '[class*="article__body"]',
    '[class*="story-body"]',
    '[class*="post-content"]',
    '[class*="entry-content"]',
    'main',
    '.content',
    '#content',
  ];

  for (const selector of contentSelectors) {
    const el = $(selector).first();
    if (el.length && el.text().trim().length > 100) {
      return {
        text: extractBlockTexts($, el, BLOCK_SELECTOR),
        archivalText: extractBlockTexts($, el, ARCHIVAL_BLOCK_SELECTOR).slice(0, MAX_ARCHIVAL_LENGTH),
      };
    }
  }

  // Last resort: full body
  return {
    text: extractBlockTexts($, $('body'), BLOCK_SELECTOR),
    archivalText: extractBlockTexts($, $('body'), ARCHIVAL_BLOCK_SELECTOR).slice(0, MAX_ARCHIVAL_LENGTH),
  };
}

/**
 * Extract archival "whole article" text from feed-inline HTML (already just
 * the article body, no surrounding page chrome to search through). Uses the
 * same narrower selector as extractText's archivalText, and also strips
 * furigana <rt> readings so they don't leak into the archived text.
 */
export function extractArchivalText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, rt').remove();
  return extractBlockTexts($, $.root(), ARCHIVAL_BLOCK_SELECTOR).slice(0, MAX_ARCHIVAL_LENGTH);
}

/**
 * Extract text from block-level elements individually, joined by double newlines.
 * This ensures sentences never cross block boundaries (e.g. between <p> tags or
 * into navigation links). Inline elements like <a> and <span> are included as
 * part of their containing block.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractBlockTexts($: ReturnType<typeof cheerio.load>, container: any, selector: string): string {
  const segments: string[] = [];

  container.find(selector).each((_: number, el: cheerio.BasicAcceptedElems<any>) => {
    const $el = $(el);
    // Skip elements nested inside another block we'll collect, to avoid duplicates
    // (e.g. <p> inside <blockquote> — collect only the outer block). Only ancestors
    // inside the container count: an article wrapped in a page-level <div> must not
    // make every one of its paragraphs look nested.
    if ($el.parentsUntil(container).filter(selector).length > 0) return;
    const text = cleanText($el.text());
    if (text.length >= 10) segments.push(text);
  });

  // Fall back to full container text if no block elements were found
  return segments.length > 0 ? segments.join('\n\n') : cleanText(container.text());
}

function cleanText(text: string): string {
  return text
    .replace(/\t/g, ' ')
    .replace(/[ \u3000]+/g, ' ')  // full-width spaces
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
