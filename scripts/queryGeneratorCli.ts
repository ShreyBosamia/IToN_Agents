import { runQueryGenerator, saveQueriesToFile } from '../src/agents/queryGenerator.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const [city, state, category] = process.argv.slice(2);

  if (!city || !state || !category) {
    console.error('Usage: tsx scripts/queryGeneratorCli.ts <city> <state> <category>');
    process.exit(1);
  }

  try {
    const queries = await runQueryGenerator(city, state, category);
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const outputDir = path.resolve(__dirname, '../examples');
    const file = saveQueriesToFile(city, category, queries, outputDir);

    console.log('Generated queries:\n');
    console.log(queries.join('\n'));
    console.log(`\nSaved to ${file}`);
  } catch (err) {
    console.error('Error generating queries:', err);
    process.exit(1);
  }
}

main();
