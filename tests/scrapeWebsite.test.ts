import { describe, expect, it, vi } from 'vitest';

import {
  resolveScraperProviderMode,
  scrapeWithProviders,
  shouldFallbackFromFirecrawl,
  type ScrapeProviderName,
  type ScrapePayload,
} from '../src/tools/scrapeWebsite';

function makeStubProvider(
  provider: ScrapeProviderName,
  result:
    | { ok: true; payload: Omit<ScrapePayload, 'provider_attempts'> }
    | { ok: false; error: string; reason?: string; status?: number; finalUrl?: string }
) {
  return {
    scrape: vi.fn(async () => ({ provider, ...result })),
  };
}

describe('scrapeWithProviders', () => {
  it('normalizes Firecrawl output into the scrape_website payload shape', async () => {
    const result = await scrapeWithProviders(
      { url: 'https://example.org' },
      {
        env: {
          FIRECRAWL_API_KEY: 'fc-test',
          SCRAPER_PROVIDER: 'firecrawl',
          FIRECRAWL_TIMEOUT_MS: '30000',
          FIRECRAWL_MAX_AGE_MS: '0',
        },
        createFirecrawlClient: () => ({
          scrape: async () => ({
            markdown: '# Example heading\n\nThis is a sufficiently long Firecrawl response body.',
            html: '<html><body><main>This is a sufficiently long Firecrawl response body.</main></body></html>',
            links: ['https://example.org/about', 'https://example.org/contact'],
            metadata: {
              title: 'Example',
              description: 'Example description',
              keywords: 'food,help',
              robots: 'index,follow',
              ogTitle: 'OG Example',
              ogDescription: 'OG description',
              ogLocale: 'en_US',
              ogUrl: 'https://example.org',
              sourceURL: 'https://example.org/final',
              statusCode: 200,
            },
          }),
        }),
        playwrightProviderFactory: () =>
          makeStubProvider('playwright', { ok: false, error: 'should not be used' }),
      }
    );

    expect(result.provider).toBe('firecrawl');
    expect(result.final_url).toBe('https://example.org/final');
    expect(result.status).toBe(200);
    expect(result.headers).toEqual({});
    expect(result.metadata?.keywords).toEqual(['food', 'help']);
    expect(result.metadata?.og).toEqual({
      title: 'OG Example',
      description: 'OG description',
      locale: 'en_US',
      url: 'https://example.org',
    });
    expect(result.data?.links).toEqual([
      { href: 'https://example.org/about', text: '', rel: '' },
      { href: 'https://example.org/contact', text: '', rel: '' },
    ]);
    expect(result.provider_attempts).toHaveLength(1);
    expect(result.provider_attempts[0]).toMatchObject({ provider: 'firecrawl', ok: true });

    const roundTrip = JSON.parse(JSON.stringify(result));
    expect(roundTrip.data.text).toContain('Firecrawl response body');
  });

  it('falls back to Playwright in auto mode when Firecrawl content is near-empty', async () => {
    const playwrightProvider = makeStubProvider('playwright', {
      ok: true,
      payload: {
        url: 'https://example.org',
        final_url: 'https://example.org',
        status: 200,
        fetched_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:01.000Z',
        headers: {},
        provider: 'playwright',
        raw_provider_metadata: {},
        data: {
          text: 'This content came from Playwright and is long enough to be useful.',
          links: [],
          htmlSnippet: '<html></html>',
        },
        truncated: { text: false, html: false },
      },
    });

    const result = await scrapeWithProviders(
      { url: 'https://example.org' },
      {
        env: {
          FIRECRAWL_API_KEY: 'fc-test',
          SCRAPER_PROVIDER: 'auto',
        },
        createFirecrawlClient: () => ({
          scrape: async () => ({
            markdown: 'tiny',
            html: '<html><body>tiny</body></html>',
            links: [],
            metadata: {
              sourceURL: 'https://example.org',
              statusCode: 200,
            },
          }),
        }),
        playwrightProviderFactory: () => playwrightProvider,
      }
    );

    expect(result.provider).toBe('playwright');
    expect(result.provider_attempts).toHaveLength(2);
    expect(result.provider_attempts[0]).toMatchObject({
      provider: 'firecrawl',
      ok: true,
      reason: 'Firecrawl returned near-empty content.',
    });
    expect(playwrightProvider.scrape).toHaveBeenCalledTimes(1);
  });

  it('falls back to Playwright in auto mode when Firecrawl is not configured', async () => {
    const playwrightProvider = makeStubProvider('playwright', {
      ok: true,
      payload: {
        url: 'https://example.org',
        final_url: 'https://example.org',
        status: 200,
        fetched_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:01.000Z',
        headers: {},
        provider: 'playwright',
        raw_provider_metadata: {},
        data: {
          text: 'Playwright fallback content.',
          links: [],
          htmlSnippet: '<html></html>',
        },
        truncated: { text: false, html: false },
      },
    });

    const result = await scrapeWithProviders(
      { url: 'https://example.org' },
      {
        env: {
          SCRAPER_PROVIDER: 'auto',
        },
        playwrightProviderFactory: () => playwrightProvider,
      }
    );

    expect(result.provider).toBe('playwright');
    expect(result.provider_attempts[0]).toMatchObject({
      provider: 'firecrawl',
      ok: false,
      error: 'Missing FIRECRAWL_API_KEY in environment.',
    });
  });

  it('does not fall back when SCRAPER_PROVIDER=firecrawl and Firecrawl is not configured', async () => {
    const result = await scrapeWithProviders(
      { url: 'https://example.org' },
      {
        env: {
          SCRAPER_PROVIDER: 'firecrawl',
        },
        playwrightProviderFactory: () =>
          makeStubProvider('playwright', { ok: false, error: 'should not run' }),
      }
    );

    expect(result.provider).toBe('firecrawl');
    expect(result.error).toContain('Missing FIRECRAWL_API_KEY');
    expect(result.provider_attempts).toHaveLength(1);
  });

  it('uses Playwright directly when SCRAPER_PROVIDER=playwright', async () => {
    const playwrightProvider = makeStubProvider('playwright', {
      ok: true,
      payload: {
        url: 'https://example.org',
        final_url: 'https://example.org',
        status: 200,
        fetched_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:01.000Z',
        headers: {},
        provider: 'playwright',
        raw_provider_metadata: {},
        data: {
          text: 'Direct Playwright mode.',
          links: [],
          htmlSnippet: '<html></html>',
        },
        truncated: { text: false, html: false },
      },
    });

    const result = await scrapeWithProviders(
      { url: 'https://example.org' },
      {
        env: {
          SCRAPER_PROVIDER: 'playwright',
        },
        firecrawlProviderFactory: () =>
          makeStubProvider('firecrawl', { ok: false, error: 'should not run' }),
        playwrightProviderFactory: () => playwrightProvider,
      }
    );

    expect(result.provider).toBe('playwright');
    expect(result.provider_attempts).toEqual([
      expect.objectContaining({ provider: 'playwright', ok: true }),
    ]);
  });
});

describe('scrape provider helpers', () => {
  it('normalizes scraper mode from environment', () => {
    expect(resolveScraperProviderMode({ SCRAPER_PROVIDER: 'FIRECRAWL' })).toBe('firecrawl');
    expect(resolveScraperProviderMode({ SCRAPER_PROVIDER: 'playwright' })).toBe('playwright');
    expect(resolveScraperProviderMode({ SCRAPER_PROVIDER: 'unknown' })).toBe('auto');
  });

  it('detects blocked Firecrawl pages for fallback', () => {
    const decision = shouldFallbackFromFirecrawl(
      {
        ok: true,
        provider: 'firecrawl',
        payload: {
          url: 'https://example.org',
          final_url: 'https://example.org',
          status: 200,
          fetched_at: '2026-01-01T00:00:00.000Z',
          finished_at: '2026-01-01T00:00:01.000Z',
          headers: {},
          provider: 'firecrawl',
          raw_provider_metadata: {},
          data: {
            text: 'Please enable JavaScript and verify you are human.',
            links: [],
            htmlSnippet: '<html></html>',
          },
          truncated: { text: false, html: false },
        },
      },
      'https://example.org'
    );

    expect(decision).toEqual({
      fallback: true,
      reason: 'Firecrawl returned a blocked or anti-bot page.',
    });
  });
});
