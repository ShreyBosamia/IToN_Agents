import { runStatewideCrawler } from '../src/agents/directory';

async function main() {
  const result = await runStatewideCrawler({
    city: 'Portland',
    state: 'OR',
    category: 'food bank',
    maxUrls: 10,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
