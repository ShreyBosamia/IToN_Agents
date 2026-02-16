import 'dotenv/config';
import { runPipeline } from '../pipeline/runPipeline.ts';

async function main() {
  const [city, state, category, perQueryArg, maxUrlsArg] = process.argv.slice(2);

  if (!city || !state || !category) {
    console.error('Usage: tsx scripts/pipeline.ts <city> <state> <category> [perQuery] [maxUrls]');
    process.exit(1);
  }

  const perQuery = perQueryArg ? Number.parseInt(perQueryArg, 10) : undefined;
  const maxUrls = maxUrlsArg ? Number.parseInt(maxUrlsArg, 10) : undefined;

  const result = await runPipeline({
    city,
    state,
    category,
    perQuery,
    maxUrls,
  });

  console.log(`Saved queries to ${result.output.query_file}`);
  console.log(`Saved pipeline output to ${result.outputFile}`);
  console.log(`Saved sanity output to ${result.sanityFile}`);
  console.log(JSON.stringify(result.output.sanity, null, 2));
  console.log(`Scraped ${result.output.urls.length} URLs`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
