import * as cheerio from 'cheerio';

// Block-level elements whose text should be kept as separate segments
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd';

/**
 * Fetch an article URL and extract readable body text.
 * Tries common content selectors before falling back to <body>.
 */
export async function scrapeArticleText(url: string): Promise<string> {
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
      return '';
    }

    const html = await res.text();
    return extractText(html);
  } catch (err) {
    console.warn(`[scraper] Failed to fetch ${url}: ${(err as Error).message}`);
    return '';
  }
}

function extractText(html: string): string {
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
      return extractBlockTexts($, el);
    }
  }

  // Last resort: full body
  return extractBlockTexts($, $('body'));
}

/**
 * Extract text from block-level elements individually, joined by double newlines.
 * This ensures sentences never cross block boundaries (e.g. between <p> tags or
 * into navigation links). Inline elements like <a> and <span> are included as
 * part of their containing block.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractBlockTexts($: ReturnType<typeof cheerio.load>, container: any): string {
  const segments: string[] = [];

  container.find(BLOCK_SELECTOR).each((_: number, el: cheerio.BasicAcceptedElems<any>) => {
    const $el = $(el);
    // Skip elements nested inside another block we'll collect, to avoid duplicates
    // (e.g. <p> inside <blockquote> — collect only the outer block)
    if ($el.parents(BLOCK_SELECTOR).length > 0) return;
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
