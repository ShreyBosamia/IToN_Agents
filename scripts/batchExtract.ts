import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgent } from '../src/agent.js';
import { SYSTEM_PROMPT } from '../src/systemPrompt.js';
import { tools } from '../src/tools/index.js';

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
  const MAX = 2;
  const targets = urls.slice(0, MAX);

  if (!targets.length) {
    console.error('No website URLs found in websites.txt.');
    process.exit(1);
  }

  const results: any[] = [];

  for (const url of targets) {
    const history = await runAgent({
      userMessage: `${SYSTEM_PROMPT}\nURL: ${url}`,
      tools,
      quiet: true,
    });
    const last = history.at(-1);
    if (last?.role === 'assistant' && last.content) {
      const raw = String(last.content).trim();
      let parsed: any = null;
      // Attempt direct parse
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Fallback: extract first top-level JSON object
        const first = raw.indexOf('{');
        const lastIdx = raw.lastIndexOf('}');
        if (first !== -1 && lastIdx !== -1 && lastIdx > first) {
          try {
            parsed = JSON.parse(raw.slice(first, lastIdx + 1));
          } catch {
            parsed = null;
          }
        }
      }
      if (parsed && typeof parsed === 'object') {
        results.push(parsed);
      } else {
        results.push({ error: 'Invalid JSON from assistant', url });
      }
    } else {
      results.push({ error: 'No assistant response captured', url });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Emit a single valid JSON array containing all results
  console.log(JSON.stringify(results, null, 2));
}

main();
