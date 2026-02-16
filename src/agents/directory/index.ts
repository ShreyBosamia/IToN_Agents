import { feedingIllinoisCrawler } from './feedingIllinoisCrawler';
import { oregonFoodFinderCrawler } from './oregonFoodFinderCrawler';
import type {
  CrawlOptions,
  DirectoryCrawlResult,
  PipelineContext,
  StatewideDirectoryCrawler,
} from './types';

const crawlers: StatewideDirectoryCrawler[] = [oregonFoodFinderCrawler, feedingIllinoisCrawler];

export async function runStatewideCrawler(
  ctx: PipelineContext,
  opts?: CrawlOptions
): Promise<DirectoryCrawlResult> {
  const crawler = crawlers.find((c) => c.supports(ctx));
  if (!crawler)
    throw new Error(`No statewide crawler supports state=${ctx.state}, category=${ctx.category}`);
  return crawler.crawl(ctx, opts);
}
