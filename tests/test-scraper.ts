import { tools } from '../src/tools/index'; // adjust the path if index.ts is in another folder

async function testScraper() {
  // Find our scraper tool
  const scraper = tools.find((t) => t.definition.function.name === 'scrape_website');
  if (!scraper) throw new Error('scrape_website tool not found');

  // Run the handler directly
  const result = await scraper.handler({
    userMessage: 'Please scrape the provided URL',
    toolArgs: { url: 'https://southbentonfoodpantry.org' },
  });

  console.log('=== SCRAPER OUTPUT ===');
  console.log(result);
}

testScraper().catch((err) => console.error(err));
