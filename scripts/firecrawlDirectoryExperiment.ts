import 'dotenv/config';

import { runFirecrawlDirectoryExperiment } from '../src/tools/scrapeWebsite.ts';

async function main() {
  const url = process.argv[2] || 'https://www.feedingillinois.org/food-banks';
  const result = await runFirecrawlDirectoryExperiment(url);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Firecrawl directory experiment failed:', error);
  process.exit(1);
});
