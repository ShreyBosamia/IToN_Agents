import { getFoodFinderTopUrls } from '../../tools/foodFinderTopUrls';

import type {
  PipelineContext,
  CrawlOptions,
  DirectoryCrawlResult,
  StatewideDirectoryCrawler,
} from './types';

export const oregonFoodFinderCrawler: StatewideDirectoryCrawler = {
  id: 'oregon_food_finder',
  name: 'Oregon Food Bank Food Finder',
  baseUrl: 'https://foodfinder.oregonfoodbank.org/',

  supports(ctx: PipelineContext) {
    const st = ctx.state.toLowerCase();
    const isOregon = st === 'or' || st === 'oregon';
    const isFood = ctx.category.toUpperCase().includes('FOOD');
    return isOregon && isFood;
  },

  async crawl(ctx: PipelineContext, opts?: CrawlOptions): Promise<DirectoryCrawlResult> {
    const maxUrls = opts?.maxUrls ?? ctx.maxUrls ?? 10;

    const result: DirectoryCrawlResult = {
      directory: {
        id: 'oregon_food_finder',
        name: 'Oregon Food Bank Food Finder',
        baseUrl: 'https://foodfinder.oregonfoodbank.org/',
        state: 'OR',
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

    const out = await getFoodFinderTopUrls({
      city: ctx.city,
      state: ctx.state,
      category: ctx.category,
      n: maxUrls,
    });

    if (out.error) {
      result.errors.push({ stage: 'navigate', message: out.error });
      return result;
    }

    const dedup = Array.from(new Set(out.urls));
    result.stats.discovered = out.urls.length;
    result.stats.duplicatesRemoved = out.urls.length - dedup.length;

    result.providerUrls = dedup.slice(0, maxUrls).map((url) => ({
      url,
      confidence: 'high',
      source: 'listing',
    }));
    result.stats.returned = result.providerUrls.length;

    return result;
  },
};
