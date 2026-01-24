import { chromium } from 'playwright';

import type { RegisteredTool } from '../../types';

const BASE = 'https://foodfinder.oregonfoodbank.org/';
const DEFAULT_N = 10;
const MAX_N = 25;

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function isProviderLike(url: string, searchUrl: string) {
  if (!url.startsWith(BASE)) return false;
  if (url === BASE) return false;
  if (url === searchUrl) return false;
  if (url.includes('/privacy') || url.includes('/terms') || url.includes('/about')) return false;
  if (url.includes('?campaign=') && url.includes('&distance=') && url.includes('&q=')) return false;
  return true;
}

export const foodFinderTopUrlsTool: RegisteredTool = {
  definition: {
    type: 'function',
    function: {
      name: 'foodFinderTopUrls',
      description:
        'Get top provider/detail URLs from Oregon Food Bank FoodFinder directory (Playwright-rendered).',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          state: { type: 'string' },
          category: { type: 'string' },
          n: { type: 'number' },
        },
        required: ['city', 'state'],
      },
    },
  },
  schema: undefined as any,
  handler: async ({ toolArgs }) => {
    const { city, state, category, n } = toolArgs as {
      city: string;
      state: string;
      category?: string;
      n?: number;
    };

    const limit = Math.max(1, Math.min(n ?? DEFAULT_N, MAX_N));
    const q = `${(category ?? 'food pantry').trim()} ${city.trim()}, ${state.trim()}`.trim();
    const searchUrl = `${BASE}?campaign=0&distance=nearby&q=${encodeURIComponent(q)}`;

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
    });
    const page = await context.newPage();

    await page.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet', 'websocket'].includes(t)) return route.abort();
      route.continue();
    });

    page.setDefaultNavigationTimeout(30_000);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      try {
        await page.waitForLoadState('networkidle', { timeout: 10_000 });
      } catch {
        void 0;
      }

      await page.waitForTimeout(1000);

      const found = new Set<string>();

      const selectors = [
        '[role="listitem"]',
        'li',
        'article',
        '[data-testid*="result"]',
        'a[href]',
      ];

      for (const sel of selectors) {
        if (found.size >= limit) break;

        const handles = await page.$$(sel);
        const toTry = handles.slice(0, 30);

        for (const h of toTry) {
          if (found.size >= limit) break;

          const before = page.url();

          let href = '';
          try {
            href = await h.evaluate((el) => {
              const a = el instanceof HTMLAnchorElement ? el : el.querySelector?.('a[href]');
              return a ? (a as HTMLAnchorElement).href : '';
            });
          } catch {
            void 0;
          }

          if (href && isProviderLike(href, searchUrl)) {
            found.add(href);
            continue;
          }

          if (!href) {
            try {
              await h.click({ timeout: 1500 });
              await page.waitForTimeout(500);
            } catch {
              void 0;
            }

            const after = page.url();
            if (after !== before && isProviderLike(after, searchUrl)) {
              found.add(after);
            }

            if (after !== before) {
              try {
                await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 });
                await page.waitForTimeout(500);
              } catch {
                try {
                  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                  await page.waitForTimeout(500);
                } catch {
                  void 0;
                }
              }
            }
          }
        }
      }

      if (found.size < limit) {
        const hrefs = await page.$$eval('a[href]', (as) =>
          as.map((a) => (a as HTMLAnchorElement).href).filter(Boolean)
        );

        for (const h of hrefs) {
          if (found.size >= limit) break;
          if (isProviderLike(h, searchUrl)) found.add(h);
        }
      }

      const urls = uniq(Array.from(found)).slice(0, limit);

      if (urls.length === 0) {
        return JSON.stringify({
          action: 'foodFinderTopUrls',
          query: q,
          n: limit,
          urls: [],
          source: 'foodfinder_directory',
          error:
            'No provider-like URLs found on FoodFinder (layout changed, results not rendered, or blocked).',
        });
      }

      return JSON.stringify({
        action: 'foodFinderTopUrls',
        query: q,
        n: limit,
        urls,
        source: 'foodfinder_directory',
      });
    } catch (e: any) {
      return JSON.stringify({
        action: 'foodFinderTopUrls',
        query: q,
        n: limit,
        urls: [],
        source: 'foodfinder_directory',
        error: e?.message ?? String(e),
      });
    } finally {
      await context.close().catch(() => void 0);
      await browser.close().catch(() => void 0);
    }
  },
};
