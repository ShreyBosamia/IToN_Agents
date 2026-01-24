import { chromium } from 'playwright';
import type { RegisteredTool } from '../../types';

const BASE = 'https://foodfinder.oregonfoodbank.org/';
const DEFAULT_N = 10;
const MAX_N = 25;

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function normalizeFoodFinderUrl(u: string) {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.toString();
  } catch {
    return u;
  }
}

function isProviderUrl(u: string) {
  if (!u.startsWith(BASE)) return false;
  if (!u.includes('/locations/')) return false;
  if (u.includes('/privacy') || u.includes('/terms') || u.includes('/about')) return false;
  return true;
}

async function collectLocationLinks(page: any, limit: number) {
  const hrefs = await page.$$eval('a[href]', (as: any[]) =>
    as.map((a) => (a as HTMLAnchorElement).href).filter(Boolean)
  );
  const urls = uniq(hrefs.map(normalizeFoodFinderUrl)).filter(isProviderUrl).slice(0, limit);
  return urls;
}

async function gentleScroll(page: any) {
  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 6; i++) {
      window.scrollBy(0, Math.max(600, window.innerHeight));
      await sleep(350);
    }
    window.scrollTo(0, 0);
  });
}

export const foodFinderTopUrlsTool: RegisteredTool = {
  definition: {
    type: 'function',
    function: {
      name: 'foodFinderTopUrls',
      description: 'Get top provider/detail URLs from Oregon Food Bank FoodFinder (Playwright-rendered).',
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

    page.setDefaultNavigationTimeout(45_000);

    const makeResult = (urls: string[], extra?: { error?: string }) =>
      JSON.stringify({
        action: 'foodFinderTopUrls',
        query: q,
        n: limit,
        urls,
        source: 'foodfinder_directory',
        ...(extra?.error ? { error: extra.error } : {}),
      });

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      try {
        await page.waitForSelector('a[href*="/locations/"]', { timeout: 15_000 });
      } catch {
        await gentleScroll(page);
        try {
          await page.waitForSelector('a[href*="/locations/"]', { timeout: 12_000 });
        } catch {}
      }

      let urls = await collectLocationLinks(page, limit);
      if (urls.length >= 1) return makeResult(urls);

      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      } catch {}

      try {
        await page.waitForSelector('a[href*="/locations/"]', { timeout: 15_000 });
      } catch {
        await gentleScroll(page);
      }

      urls = await collectLocationLinks(page, limit);
      if (urls.length >= 1) return makeResult(urls);

      return makeResult([], 'No provider-like URLs found on FoodFinder (layout changed, results not rendered, or blocked).'
        ? { error: 'No provider-like URLs found on FoodFinder (layout changed, results not rendered, or blocked).' }
        : undefined);
    } catch (e: any) {
      return makeResult([], { error: e?.message ?? String(e) });
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  },
};
