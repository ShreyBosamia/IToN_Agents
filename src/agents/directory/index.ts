import { oregonFoodFinderCrawler } from './oregonFoodFinderCrawler';
import type {
  PipelineContext,
  CrawlOptions,
  DirectoryCrawlResult,
  StatewideDirectoryCrawler,
} from './types';

const crawlers: StatewideDirectoryCrawler[] = [oregonFoodFinderCrawler];

export async function runStatewideCrawler(
  ctx: PipelineContext,
  opts?: CrawlOptions
): Promise<DirectoryCrawlResult> {
  const crawler = crawlers.find((c) => c.supports(ctx));
  if (!crawler)
    throw new Error(`No statewide crawler supports state=${ctx.state}, category=${ctx.category}`);
  return crawler.crawl(ctx, opts);
}

