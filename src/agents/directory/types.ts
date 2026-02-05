export type PipelineContext = {
  city: string;
  state: string;
  category: string;
  zip?: string;
  maxUrls?: number;
};

export type CrawlOptions = {
  maxUrls?: number;
};

export type DirectoryCrawlResult = {
  directory: { id: string; name: string; baseUrl: string; state?: string };
  generatedAt: string;
  input: PipelineContext;
  providerUrls: Array<{
    url: string;
    confidence: 'high' | 'medium' | 'low';
    source: 'listing' | 'search_result' | 'map_pin' | 'pagination';
  }>;
  stats: {
    discovered: number;
    returned: number;
    duplicatesRemoved: number;
    pagesVisited: number;
    blockedEvents: number;
  };
  errors: Array<{
    stage: 'navigate' | 'search' | 'parse' | 'paginate' | 'rate_limit';
    message: string;
    url?: string;
  }>;
};

export interface StatewideDirectoryCrawler {
  id: string;
  name: string;
  baseUrl: string;
  supports(ctx: PipelineContext): boolean;
  crawl(ctx: PipelineContext, opts?: CrawlOptions): Promise<DirectoryCrawlResult>;
}
