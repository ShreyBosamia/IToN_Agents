import { createHash } from 'crypto';

import Firecrawl, { type Document as FirecrawlDocument } from '@mendable/firecrawl-js';
import { chromium } from 'playwright';

import type { RegisteredTool } from '../types';

const MAX_TEXT = 8000;
const MAX_HTML = 12000;
const MAX_LINKS = 300;
const DEFAULT_FIRECRAWL_TIMEOUT_MS = 30_000;
const DEFAULT_FIRECRAWL_MAX_AGE_MS = 0;
const MIN_USEFUL_TEXT_LENGTH = 120;

const BLOCKED_PAGE_PATTERNS = [
  'captcha',
  'cf-browser-verification',
  'cloudflare',
  'enable javascript',
  'access denied',
  'verify you are human',
  'robot or human',
  'temporarily blocked',
];

const PLAYWRIGHT_FIRST_HOSTS = new Set([
  'foodfinder.oregonfoodbank.org',
  'www.foodfinder.oregonfoodbank.org',
]);

export type ScrapeToolArgs = {
  url: string;
  waitForSelector?: string;
  waitForNetworkIdleMs?: number;
  includeAllContent?: boolean;
};

export type ScrapeProviderName = 'firecrawl' | 'playwright';

export type ScrapeLink = {
  href: string;
  text: string;
  rel: string;
};

export type ScrapePayload = {
  url: string;
  final_url: string;
  status: number;
  fetched_at: string;
  finished_at: string;
  headers: Record<string, string>;
  dom_hash?: string;
  metadata?: {
    title: string;
    description: string;
    keywords: string[];
    canonical: string;
    robots: string;
    og: {
      title: string;
      description: string;
      locale: string;
      url: string;
    };
    ld_json: unknown[];
  };
  data?: {
    text: string;
    links: ScrapeLink[];
    htmlSnippet: string;
  };
  truncated?: {
    text: boolean;
    html: boolean;
  };
  error?: string;
  provider: ScrapeProviderName;
  provider_attempts: ScrapeProviderAttempt[];
  raw_provider_metadata: Record<string, unknown>;
};

export type ScrapeProviderAttempt = {
  provider: ScrapeProviderName;
  ok: boolean;
  error?: string;
  reason?: string;
  status?: number;
  final_url?: string;
};

type ScrapeProviderSuccess = {
  ok: true;
  provider: ScrapeProviderName;
  payload: Omit<ScrapePayload, 'provider_attempts'>;
};

type ScrapeProviderFailure = {
  ok: false;
  provider: ScrapeProviderName;
  error: string;
  reason?: string;
  status?: number;
  finalUrl?: string;
  rawProviderMetadata?: Record<string, unknown>;
};

type ScrapeProviderResult = ScrapeProviderSuccess | ScrapeProviderFailure;

type ScrapeProvider = {
  scrape(args: ScrapeToolArgs): Promise<ScrapeProviderResult>;
};

type FirecrawlClientLike = {
  scrape(url: string, options?: Record<string, unknown>): Promise<FirecrawlDocument>;
  map?(
    url: string,
    options?: Record<string, unknown>
  ): Promise<{ links?: string[]; [key: string]: unknown }>;
  crawl?(
    url: string,
    options?: Record<string, unknown>
  ): Promise<{ data?: Array<Record<string, unknown>>; status?: string; [key: string]: unknown }>;
};

type ScrapeProviderDeps = {
  env?: NodeJS.ProcessEnv;
  createFirecrawlClient?: (apiKey: string) => FirecrawlClientLike;
  firecrawlProviderFactory?: (
    deps?: Pick<ScrapeProviderDeps, 'env' | 'createFirecrawlClient'>
  ) => ScrapeProvider;
  playwrightProviderFactory?: () => ScrapeProvider;
};

function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeFirecrawlLinks(links: unknown): ScrapeLink[] {
  if (!Array.isArray(links)) return [];

  const out: ScrapeLink[] = [];
  const seen = new Set<string>();

  for (const item of links) {
    const href = typeof item === 'string' ? item.trim() : '';
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: '', rel: '' });
    if (out.length >= MAX_LINKS) break;
  }

  return out;
}

function buildDomHash(source: string): string | undefined {
  if (!source) return undefined;
  return createHash('sha256').update(source).digest('hex');
}

function textLooksBlocked(text: string): boolean {
  const normalized = text.toLowerCase();
  return BLOCKED_PAGE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function isPlaywrightFirstHost(url: string, env = process.env): boolean {
  const configured = (env.PLAYWRIGHT_FIRST_HOSTS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (PLAYWRIGHT_FIRST_HOSTS.has(hostname)) return true;
  return configured.includes(hostname);
}

export function resolveScraperProviderMode(env = process.env): 'auto' | 'firecrawl' | 'playwright' {
  const raw = (env.SCRAPER_PROVIDER || 'auto').trim().toLowerCase();
  if (raw === 'firecrawl' || raw === 'playwright') return raw;
  return 'auto';
}

export function shouldFallbackFromFirecrawl(
  result: ScrapeProviderResult,
  url: string,
  env = process.env
): { fallback: boolean; reason?: string } {
  if (isPlaywrightFirstHost(url, env)) {
    return { fallback: true, reason: 'Host configured for Playwright-first scraping.' };
  }

  if (!result.ok) {
    return {
      fallback: true,
      reason: result.reason || result.error || 'Firecrawl scrape failed.',
    };
  }

  const text = result.payload.data?.text?.trim() || '';
  const htmlSnippet = result.payload.data?.htmlSnippet?.trim() || '';
  const status = result.payload.status || 0;

  if (result.payload.error) {
    return { fallback: true, reason: result.payload.error };
  }

  if (status >= 400 || status === 0) {
    return { fallback: true, reason: `Firecrawl returned status ${status || 'unknown'}.` };
  }

  if (textLooksBlocked(`${text}\n${htmlSnippet}`)) {
    return { fallback: true, reason: 'Firecrawl returned a blocked or anti-bot page.' };
  }

  if (text.length < MIN_USEFUL_TEXT_LENGTH && result.payload.data?.links?.length === 0) {
    return { fallback: true, reason: 'Firecrawl returned near-empty content.' };
  }

  return { fallback: false };
}

function buildErrorPayload(
  args: ScrapeToolArgs,
  provider: ScrapeProviderName,
  attempt: ScrapeProviderAttempt,
  rawProviderMetadata: Record<string, unknown> = {}
): ScrapePayload {
  const fetchedAt = new Date().toISOString();

  return {
    url: args.url,
    final_url: attempt.final_url || args.url,
    status: attempt.status || 0,
    fetched_at: fetchedAt,
    finished_at: new Date().toISOString(),
    headers: {},
    error: attempt.error || `${provider} scrape failed.`,
    provider,
    provider_attempts: [attempt],
    raw_provider_metadata: rawProviderMetadata,
  };
}

function toAttempt(result: ScrapeProviderResult, fallbackReason?: string): ScrapeProviderAttempt {
  if (result.ok) {
    return {
      provider: result.provider,
      ok: true,
      status: result.payload.status,
      final_url: result.payload.final_url,
      reason: fallbackReason,
    };
  }

  return {
    provider: result.provider,
    ok: false,
    error: result.error,
    reason: fallbackReason || result.reason,
    status: result.status,
    final_url: result.finalUrl,
  };
}

function createFirecrawlProvider(
  deps?: Pick<ScrapeProviderDeps, 'env' | 'createFirecrawlClient'>
): ScrapeProvider {
  const env = deps?.env ?? process.env;

  return {
    async scrape(args: ScrapeToolArgs): Promise<ScrapeProviderResult> {
      const apiKey = env.FIRECRAWL_API_KEY;
      if (!apiKey) {
        return {
          ok: false,
          provider: 'firecrawl',
          error: 'Missing FIRECRAWL_API_KEY in environment.',
          reason: 'Firecrawl is not configured.',
        };
      }

      const client =
        deps?.createFirecrawlClient?.(apiKey) ??
        new Firecrawl({ apiKey, apiUrl: 'https://api.firecrawl.dev' });
      const fetchedAt = new Date().toISOString();
      const timeout = parseIntEnv(env.FIRECRAWL_TIMEOUT_MS, DEFAULT_FIRECRAWL_TIMEOUT_MS);
      const maxAge = parseIntEnv(env.FIRECRAWL_MAX_AGE_MS, DEFAULT_FIRECRAWL_MAX_AGE_MS);

      try {
        const doc = await client.scrape(args.url, {
          formats: ['markdown', 'html', 'links'],
          onlyMainContent: !args.includeAllContent,
          timeout,
          maxAge,
          location: {
            country: 'US',
            languages: ['en-US'],
          },
        });

        const markdown = typeof doc.markdown === 'string' ? doc.markdown : '';
        const html = typeof doc.html === 'string' ? doc.html : '';
        const links = normalizeFirecrawlLinks(doc.links);
        const metadata = doc.metadata ?? {};
        const fullText = markdown.trim();
        const htmlSnippet = html.slice(0, MAX_HTML);

        const payload: Omit<ScrapePayload, 'provider_attempts'> = {
          url: args.url,
          final_url:
            typeof metadata.sourceURL === 'string' && metadata.sourceURL.trim()
              ? metadata.sourceURL
              : args.url,
          status: typeof metadata.statusCode === 'number' ? metadata.statusCode : 0,
          fetched_at: fetchedAt,
          finished_at: new Date().toISOString(),
          headers: {},
          dom_hash: buildDomHash(html || markdown),
          metadata: {
            title: typeof metadata.title === 'string' ? metadata.title : '',
            description: typeof metadata.description === 'string' ? metadata.description : '',
            keywords: normalizeKeywords(metadata.keywords),
            canonical: typeof metadata.sourceURL === 'string' ? metadata.sourceURL : '',
            robots: typeof metadata.robots === 'string' ? metadata.robots : '',
            og: {
              title: typeof metadata.ogTitle === 'string' ? metadata.ogTitle : '',
              description: typeof metadata.ogDescription === 'string' ? metadata.ogDescription : '',
              locale: typeof metadata.ogLocale === 'string' ? metadata.ogLocale : '',
              url: typeof metadata.ogUrl === 'string' ? metadata.ogUrl : '',
            },
            ld_json: [],
          },
          data: {
            text: fullText.slice(0, MAX_TEXT),
            links,
            htmlSnippet,
          },
          truncated: {
            text: fullText.length > MAX_TEXT,
            html: html.length > htmlSnippet.length,
          },
          provider: 'firecrawl',
          raw_provider_metadata: {
            warning: doc.warning,
            metadata,
            formats: {
              markdown: Boolean(doc.markdown),
              html: Boolean(doc.html),
              links: Array.isArray(doc.links),
            },
          },
        };

        if (metadata.error && !payload.error) {
          payload.error = String(metadata.error);
        }

        return {
          ok: true,
          provider: 'firecrawl',
          payload,
        };
      } catch (error: any) {
        const message = error?.message || String(error);
        return {
          ok: false,
          provider: 'firecrawl',
          error: `Firecrawl failed: ${message}`,
          reason: /timeout/i.test(message) ? 'Firecrawl timed out.' : undefined,
          rawProviderMetadata: {
            name: error?.name,
          },
        };
      }
    },
  };
}

function createPlaywrightProvider(): ScrapeProvider {
  return {
    async scrape(args: ScrapeToolArgs): Promise<ScrapeProviderResult> {
      const { url, waitForSelector, waitForNetworkIdleMs, includeAllContent } = args;

      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: undefined,
        locale: 'en-US',
      });
      const page = await context.newPage();

      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'media', 'font', 'stylesheet', 'websocket'].includes(resourceType)) {
          return route.abort();
        }
        return route.continue();
      });

      page.setDefaultNavigationTimeout(30_000);

      let status = 0;
      let headers: Record<string, string> = {};
      let finalUrl = url;
      const fetchedAt = new Date().toISOString();

      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });

        if (response) {
          status = response.status();
          headers = await response.headers();
          finalUrl = response.url();
        } else {
          finalUrl = page.url() || url;
        }

        if (waitForSelector) {
          await page.waitForSelector(waitForSelector, { timeout: 15_000 });
        } else if (waitForNetworkIdleMs && waitForNetworkIdleMs > 0) {
          await page.waitForLoadState('networkidle', {
            timeout: Math.min(waitForNetworkIdleMs, 10_000),
          });
        }

        const title = await page.title();
        const description = await page.evaluate(() => {
          const el = document.querySelector("meta[name='description']");
          return el ? el.getAttribute('content') || '' : '';
        });

        const keywords = await page.evaluate(() => {
          const el = document.querySelector("meta[name='keywords']");
          const raw = el ? el.getAttribute('content') || '' : '';
          return raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        });

        const metaExtras = await page.evaluate(
          (opts) => {
            const og = {
              title:
                document.querySelector("meta[property='og:title']")?.getAttribute('content') || '',
              description:
                document
                  .querySelector("meta[property='og:description']")
                  ?.getAttribute('content') || '',
              locale:
                document.querySelector("meta[property='og:locale']")?.getAttribute('content') || '',
              url: document.querySelector("meta[property='og:url']")?.getAttribute('content') || '',
            };

            const canonicalEl = document.querySelector("link[rel='canonical']");
            const canonical = canonicalEl ? canonicalEl.getAttribute('href') || '' : '';

            const robotsEl = document.querySelector("meta[name='robots']");
            const robots = robotsEl ? robotsEl.getAttribute('content') || '' : '';

            const scripts = Array.from(
              document.querySelectorAll("script[type='application/ld+json']")
            );
            const ld_json = [];
            for (const script of scripts) {
              const raw = (script.textContent || '').trim();
              if (!raw) continue;
              try {
                const cleaned = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/g, '');
                ld_json.push(JSON.parse(cleaned));
              } catch {
                continue;
              }
            }

            const mainEl = document.querySelector('main, article');
            const bodyText = (document.body && (document.body.innerText || '').trim()) || '';
            const mainText = opts.includeAllContent
              ? bodyText
              : (mainEl && (mainEl.textContent || '').trim()) || bodyText || '';

            return { canonical, robots, og, ld_json, mainText };
          },
          { includeAllContent: Boolean(includeAllContent) }
        );

        const fullText = String(metaExtras.mainText || '');
        const text = fullText.slice(0, MAX_TEXT);

        const links = await page.$$eval(
          'a',
          (anchors, opts) => {
            const { baseHref, maxLinks } = opts as { baseHref: string; maxLinks: number };
            const out: Array<{ href: string; text: string; rel: string }> = [];
            const seen = new Set<string>();

            for (const anchor of anchors as HTMLAnchorElement[]) {
              const rawHref = anchor.getAttribute('href') || '';
              let href = '';
              try {
                href = new URL(rawHref, baseHref).href;
              } catch {
                continue;
              }
              if (!href || seen.has(href)) continue;
              seen.add(href);
              out.push({
                href,
                text: (anchor.textContent || '').trim(),
                rel: (anchor.getAttribute('rel') || '').toLowerCase(),
              });
              if (out.length >= maxLinks) break;
            }

            return out;
          },
          { baseHref: finalUrl, maxLinks: MAX_LINKS }
        );

        const html = await page.content();
        const htmlSnippet = html.slice(0, MAX_HTML);

        return {
          ok: true,
          provider: 'playwright',
          payload: {
            url,
            final_url: finalUrl,
            status,
            fetched_at: fetchedAt,
            finished_at: new Date().toISOString(),
            headers,
            dom_hash: buildDomHash(html),
            metadata: {
              title,
              description,
              keywords,
              canonical: metaExtras.canonical,
              robots: metaExtras.robots,
              og: metaExtras.og,
              ld_json: metaExtras.ld_json,
            },
            data: {
              text,
              links,
              htmlSnippet,
            },
            truncated: {
              text: fullText.length > text.length,
              html: html.length > htmlSnippet.length,
            },
            provider: 'playwright',
            raw_provider_metadata: {},
          },
        };
      } catch (error: any) {
        return {
          ok: false,
          provider: 'playwright',
          error: `Playwright failed: ${error?.message || String(error)}`,
          status,
          finalUrl,
        };
      } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    },
  };
}

export async function scrapeWithProviders(
  args: ScrapeToolArgs,
  deps?: ScrapeProviderDeps
): Promise<ScrapePayload> {
  const env = deps?.env ?? process.env;
  const mode = resolveScraperProviderMode(env);
  const firecrawlProvider =
    deps?.firecrawlProviderFactory?.({
      env,
      createFirecrawlClient: deps?.createFirecrawlClient,
    }) ?? createFirecrawlProvider({ env, createFirecrawlClient: deps?.createFirecrawlClient });
  const playwrightProvider = deps?.playwrightProviderFactory?.() ?? createPlaywrightProvider();

  if (mode === 'playwright') {
    const result = await playwrightProvider.scrape(args);
    const attempt = toAttempt(result);
    if (!result.ok) {
      return buildErrorPayload(args, 'playwright', attempt);
    }
    return {
      ...result.payload,
      provider_attempts: [attempt],
    };
  }

  const firecrawlResult = await firecrawlProvider.scrape(args);
  const fallbackDecision =
    mode === 'auto'
      ? shouldFallbackFromFirecrawl(firecrawlResult, args.url, env)
      : { fallback: false };
  const firecrawlAttempt = toAttempt(firecrawlResult, fallbackDecision.reason);

  if (!fallbackDecision.fallback) {
    if (!firecrawlResult.ok) {
      return buildErrorPayload(
        args,
        'firecrawl',
        firecrawlAttempt,
        firecrawlResult.rawProviderMetadata || {}
      );
    }

    return {
      ...firecrawlResult.payload,
      provider_attempts: [firecrawlAttempt],
    };
  }

  const playwrightResult = await playwrightProvider.scrape(args);
  const playwrightAttempt = toAttempt(playwrightResult);

  if (!playwrightResult.ok) {
    const lastFailure = buildErrorPayload(
      args,
      'playwright',
      playwrightAttempt,
      playwrightResult.rawProviderMetadata || {}
    );
    lastFailure.provider_attempts = [firecrawlAttempt, playwrightAttempt];
    return lastFailure;
  }

  return {
    ...playwrightResult.payload,
    provider_attempts: [firecrawlAttempt, playwrightAttempt],
  };
}

export const scrapeWebsiteTool: RegisteredTool = {
  definition: {
    type: 'function',
    function: {
      name: 'scrape_website',
      description: 'Render a page and return trimmed text, links, and meta',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL with protocol' },
          waitForSelector: {
            type: 'string',
            description: 'Optional CSS selector to await',
          },
          waitForNetworkIdleMs: { type: 'number' },
        },
        required: ['url'],
      },
    },
  },
  schema: undefined as any,
  handler: async ({ toolArgs }) => {
    const result = await scrapeWithProviders(toolArgs as ScrapeToolArgs);
    return JSON.stringify(result);
  },
};

export async function runFirecrawlDirectoryExperiment(
  url: string,
  deps?: Pick<ScrapeProviderDeps, 'env' | 'createFirecrawlClient'>
): Promise<{
  url: string;
  generatedAt: string;
  map: { discovered: number; sample: string[] };
  crawl: {
    status: string;
    discovered: number;
    sample: string[];
  };
}> {
  const env = deps?.env ?? process.env;
  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('Missing FIRECRAWL_API_KEY in environment.');
  }

  const client =
    deps?.createFirecrawlClient?.(apiKey) ??
    new Firecrawl({ apiKey, apiUrl: 'https://api.firecrawl.dev' });

  const mapResult = await client.map?.(url, {
    limit: 100,
    includeSubdomains: false,
    sitemap: 'include',
  });

  const crawlResult = await client.crawl?.(url, {
    limit: 25,
    sitemap: 'include',
    crawlEntireDomain: false,
    allowSubdomains: false,
    scrapeOptions: {
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: parseIntEnv(env.FIRECRAWL_TIMEOUT_MS, DEFAULT_FIRECRAWL_TIMEOUT_MS),
    },
    pollInterval: 2,
    timeout: 120,
  });

  const mapLinks = Array.isArray(mapResult?.links)
    ? mapResult.links
        .map((item) =>
          item && typeof item === 'object' && 'url' in item && typeof item.url === 'string'
            ? item.url
            : ''
        )
        .filter((item): item is string => Boolean(item))
    : [];
  const crawlData = Array.isArray(crawlResult?.data) ? crawlResult.data : [];
  const crawlUrls = crawlData
    .map((doc) =>
      typeof doc.metadata === 'object' && doc.metadata ? (doc.metadata as any).sourceURL : ''
    )
    .filter((item): item is string => Boolean(item));

  return {
    url,
    generatedAt: new Date().toISOString(),
    map: {
      discovered: mapLinks.length,
      sample: mapLinks.slice(0, 10),
    },
    crawl: {
      status: typeof crawlResult?.status === 'string' ? crawlResult.status : 'unknown',
      discovered: crawlUrls.length,
      sample: crawlUrls.slice(0, 10),
    },
  };
}
