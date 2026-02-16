import { runStatewideCrawler } from '../src/agents/directory';

async function main() {
  const out = await runStatewideCrawler(
    {
      city: 'Chicago',
      state: 'IL',
      category: 'FOOD_BANK',
      maxUrls: 10,
    },
    { maxUrls: 10 }
  );

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
