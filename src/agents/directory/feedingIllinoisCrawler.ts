import type {
  CrawlOptions,
  DirectoryCrawlResult,
  PipelineContext,
  StatewideDirectoryCrawler,
} from './types';

const FEEDING_IL_BASE = 'https://www.feedingillinois.org/';
const FEEDING_IL_LIST = 'https://www.feedingillinois.org/food-banks';

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function isHttpUrl(u: string) {
  return u.startsWith('http://') || u.startsWith('https://');
}

function looksLikeJunkLink(url: string) {
  const lower = url.toLowerCase();

  // schemes
  if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('javascript:'))
    return true;

  // social / video
  if (
    lower.includes('facebook.com') ||
    lower.includes('instagram.com') ||
    lower.includes('twitter.com') ||
    lower.includes('x.com') ||
    lower.includes('linkedin.com') ||
    lower.includes('youtube.com')
  )
    return true;

  // common assets
  if (
    lower.endsWith('.pdf') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.css') ||
    lower.endsWith('.js') ||
    lower.endsWith('.woff') ||
    lower.endsWith('.woff2') ||
    lower.endsWith('.ttf')
  )
    return true;

  // squarespace / cdn / fonts / trackers
  if (
    lower.includes('squarespace.com') ||
    lower.includes('squarespace-cdn.com') ||
    lower.includes('sqspcdn.com') ||
    lower.includes('static1.squarespace.com') ||
    lower.includes('fonts.googleapis.com') ||
    lower.includes('fonts.gstatic.com') ||
    lower.includes('googletagmanager.com') ||
    lower.includes('google-analytics.com')
  )
    return true;

  return false;
}

/**
 * Minimal HTML href extractor (no deps).
 */
function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const href = (m[1] ?? m[2] ?? '').trim();
    if (href) out.push(href);
  }

  return out;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  return res.text();
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function scoreProviderUrl(url: string): number {
  // higher score = better representative provider homepage
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.replace(/\/+$/, ''); // trim trailing slash

    let score = 0;

    // Prefer non-government (optional; keeps list cleaner)
    if (host.endsWith('.gov')) score -= 50;

    // Prefer shorter paths (homepage)
    const depth = path === '' ? 0 : path.split('/').filter(Boolean).length;
    score += Math.max(0, 20 - depth * 5);

    // Penalize common non-home actions
    if (path.includes('donate')) score -= 5;
    if (path.includes('volunteer')) score -= 5;
    if (path.includes('give')) score -= 3;
    if (path.includes('get-help') || path.includes('help')) score -= 2;
    if (path.includes('map') || path.includes('locations')) score -= 2;

    // Bonus for root
    if (path === '' || path === '/') score += 10;

    return score;
  } catch {
    return -999;
  }
}

function pickBestPerDomain(urls: string[], limit: number): string[] {
  const bestByHost = new Map<string, string>();

  for (const url of urls) {
    const host = hostnameOf(url);
    if (!host) continue;

    const current = bestByHost.get(host);
    if (!current) {
      bestByHost.set(host, url);
      continue;
    }

    if (scoreProviderUrl(url) > scoreProviderUrl(current)) {
      bestByHost.set(host, url);
    }
  }

  const picked = Array.from(bestByHost.values());
  picked.sort((a, b) => scoreProviderUrl(b) - scoreProviderUrl(a));

  return picked.slice(0, limit);
}

async function getFeedingIllinoisTopUrls(limit: number): Promise<string[]> {
  const html = await fetchHtml(FEEDING_IL_LIST);
  const hrefs = extractHrefs(html);

  const normalized = hrefs
    .map((h) => {
      try {
        return new URL(h, FEEDING_IL_BASE).toString();
      } catch {
        return null;
      }
    })
    .filter((u): u is string => Boolean(u))
    .filter((u) => isHttpUrl(u))
    .filter((u) => !looksLikeJunkLink(u));

  // We only want external member food bank websites (providers).
  // feedingillinois.org itself is a directory, not a provider.
  const providerCandidates = normalized.filter((u) => {
    const lower = u.toLowerCase();
    const isSameSite = lower.startsWith(FEEDING_IL_BASE.toLowerCase());
    if (isSameSite) return false;
    return true;
  });

  const dedup = uniq(providerCandidates);
  return pickBestPerDomain(dedup, limit);
}

export const feedingIllinoisCrawler: StatewideDirectoryCrawler = {
  id: 'feeding_illinois_food_banks',
  name: 'Feeding Illinois Food Banks',
  baseUrl: FEEDING_IL_LIST,

  supports(ctx: PipelineContext) {
    const st = ctx.state.toLowerCase();
    const isIllinois = st === 'il' || st === 'illinois';
    const isFood = ctx.category.toUpperCase().includes('FOOD');
    return isIllinois && isFood;
  },

  async crawl(ctx: PipelineContext, opts?: CrawlOptions): Promise<DirectoryCrawlResult> {
    const maxUrls = opts?.maxUrls ?? ctx.maxUrls ?? 10;

    const result: DirectoryCrawlResult = {
      directory: {
        id: 'feeding_illinois_food_banks',
        name: 'Feeding Illinois Food Banks',
        baseUrl: FEEDING_IL_LIST,
        state: 'IL',
      },
      generatedAt: new Date().toISOString(),
      input: ctx,
      providerUrls: [],
      stats: {
        discovered: 0,
        returned: 0,
        duplicatesRemoved: 0,
        pagesVisited: 0,
        blockedEvents: 0,
      },
      errors: [],
    };

    try {
      const urls = await getFeedingIllinoisTopUrls(maxUrls);

      result.stats.pagesVisited = 1;
      result.stats.discovered = urls.length;

      const dedup = uniq(urls);
      result.stats.duplicatesRemoved = urls.length - dedup.length;

      result.providerUrls = dedup.slice(0, maxUrls).map((url) => ({
        url,
        confidence: 'medium',
        source: 'listing',
      }));
      result.stats.returned = result.providerUrls.length;

      if (result.providerUrls.length === 0) {
        result.errors.push({
          stage: 'discover',
          message:
            'No provider-like external URLs found on Feeding Illinois listing page. Page may be rendering member links dynamically.',
        });
      }

      return result;
    } catch (e: any) {
      result.errors.push({
        stage: 'navigate',
        message: e?.message ?? String(e),
      });
      return result;
    }
  },
};
