import { extractServiceDataTool } from '../src/tools/extract_service_data';
import { markdownToService } from '../src/agents/markdownToService';

/**
 * A simple CLI script to validate the scraping and Sanity conversion pipeline.
 *
 * Usage:
 *   npx tsx scripts/testServiceExtraction.ts <URL>
 *
 * The script will run the `extract_service_data` tool against the provided URL
 * (falling back to Playwright if necessary), print the scraped Markdown and
 * structured data, then convert it into a Sanity‐compatible service object
 * using the `markdownToService` helper.  The resulting JSON is logged to
 * stdout for inspection.
 */
async function main() {
  const url = process.argv[2] || 'https://example.com';
  console.log(`Fetching ${url} ...`);
  // Invoke the extract_service_data tool directly.  The handler expects an
  // object with a `toolArgs` property; we include an empty userMessage for
  // completeness, though it is unused by the handler.
  const raw = (await extractServiceDataTool.handler({
    userMessage: '',
    toolArgs: { url },
  })) as unknown as string;
  const scraped = JSON.parse(raw);
  console.log('\nRaw scrape result:\n');
  console.dir(scraped, { depth: null });
  // If structuredData is "None found", normalise it to undefined
  const structured = scraped.structuredData === 'None found' ? undefined : scraped.structuredData;
  const service = await markdownToService({
    title: scraped.title,
    markdown: scraped.markdown,
    structuredData: structured,
  });
  console.log('\nConverted service object:\n');
  console.log(JSON.stringify(service, null, 2));
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});