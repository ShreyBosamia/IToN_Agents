import 'dotenv/config';

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const MAX_RESULTS_PER_QUERY = 20;
const DEFAULT_DELAY_MS = 1100;
const DEFAULT_MAX_RETRIES = 3;

export type SearchResult = {
  query: string;
  urls: string[];
};

type BraveWebResult = {
  url?: string;
  link?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveWebResult[];
  };
};

function clampCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 1;
  return Math.min(Math.floor(count), MAX_RESULTS_PER_QUERY);
}

function normalizeUrls(results: BraveWebResult[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const result of results) {
    const raw = result.url || result.link || '';
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    urls.push(raw);
  }
  return urls;
}

async function braveSearch(
  query: string,
  count: number,
  options?: { maxRetries?: number; retryDelayMs?: number }
): Promise<string[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error('Missing BRAVE_SEARCH_API_KEY in environment.');
  }

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(clampCount(count)));
  url.searchParams.set('source', 'web');

  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_DELAY_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    const bodyText = await response.text();
    if (response.ok) {
      let data: BraveSearchResponse;
      try {
        data = JSON.parse(bodyText) as BraveSearchResponse;
      } catch {
        throw new Error('Failed to parse Brave Search API response JSON.');
      }

      const results = data.web?.results ?? [];
      return normalizeUrls(results);
    }

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (!shouldRetry || attempt === maxRetries) {
      throw new Error(`Brave Search API error ${response.status}: ${bodyText}`);
    }

    const delay = retryDelayMs * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return [];
}

export async function runSearchAgent(
  queries: string[],
  options?: { perQuery?: number; delayMs?: number; maxRetries?: number; retryDelayMs?: number }
): Promise<SearchResult[]> {
  const perQuery = clampCount(options?.perQuery ?? 5);
  const delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
  const results: SearchResult[] = [];

  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i];
    const urls = await braveSearch(query, perQuery, {
      maxRetries: options?.maxRetries,
      retryDelayMs: options?.retryDelayMs,
    });
    results.push({ query, urls });

    if (delayMs > 0 && i < queries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
