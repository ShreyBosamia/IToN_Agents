import { runQueryGenerator, saveQueriesToFile } from '../queryGeneratorAgents';

async function main() {
  const [city, state, category] = process.argv.slice(2);

  if (!city || !state || !category) {
    console.error('Usage: tsx scripts/queryGeneratorCli.ts <city> <state> <category>');
    process.exit(1);
  }

  try {
    const queries = await runQueryGenerator(city, state, category);
    const file = saveQueriesToFile(city, category, queries);

    console.log('Generated queries:\n');
    console.log(queries.join('\n'));
    console.log(`\nSaved to ${file}`);
  } catch (err) {
    console.error('Error generating queries:', err);
    process.exit(1);
  }
}

main();