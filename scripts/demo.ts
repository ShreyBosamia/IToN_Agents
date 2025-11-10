import 'dotenv/config';
import { runAgent } from '../src/agent.js';
import { tools } from '../src/tools/index.js';

async function main() {
  console.log('=== DEMO RUN ===\n');
  
  await runAgent({
    userMessage: 'Extract contact info from South Benton Food Pantry',
    tools,
  });
}

main();
