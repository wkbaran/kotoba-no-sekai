import * as cheerio from 'cheerio';

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
      return cleanText(el.text());
    }
  }

  // Last resort: full body
  return cleanText($('body').text());
}

function cleanText(text: string): string {
  return text
    .replace(/\t/g, ' ')
    .replace(/[ \u3000]+/g, ' ')  // full-width spaces
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
