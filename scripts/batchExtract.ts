import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgent } from '../src/agent.js';
import { tools } from '../src/tools/index.js';
import { SYSTEM_PROMPT } from '../src/systemPrompt.js';

async function main() {
  // Resolve and read websites.txt
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sitesPath = path.resolve(__dirname, '../websites.txt');
  const raw = await readFile(sitesPath, 'utf-8');
  const urls = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && /^https?:\/\//i.test(s));

  // Take first whatever MAX is and run extraction.
  const MAX = 3;
  const targets = urls.slice(0, MAX);

  if (!targets.length) {
    console.error('No website URLs found in websites.txt.');
    process.exit(1);
  }

  console.log(`Extracting ${targets.length} website(s) from websites.txt...`);

  for (const url of targets) {
    console.log('\n=== TARGET ===');
    console.log(`URL: ${url}`);
    const history = await runAgent({
      // Use the existing system prompt as the user message, appending target URL
      userMessage: `${SYSTEM_PROMPT}\nURL: ${url}`,
      tools,
    });
    const last = history.at(-1);
    if (last?.role === 'assistant') {
      console.log('Result:\n', last.content);
    } else {
      console.log('No assistant response captured.');
    }
    // brief delay to avoid hammering sites
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
