import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgent } from '../src/agent.js';
import { tools } from '../src/tools/index.js';

// Types
import type { ChatCompletionMessageParam } from "openai/resources/index.mjs";

// The real return type of runAgent()
export type RunAgentResponse = ChatCompletionMessageParam[];

// Utility: Normalize domain

function normalizeDomain(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Utility: Extract URLs from response

function extractUrlsFromResponse(content: string): string[] {
  const urlRegex = /\bhttps?:\/\/[^\s"'<>]+/gi;
  return content.match(urlRegex) ?? [];
}
// Main

async function main(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sitesPath = path.resolve(__dirname, '../websites.txt');

  const raw = await readFile(sitesPath, 'utf-8');

  const urls: string[] = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && /^https?:\/\//i.test(s));

  if (!urls.length) {
    console.error('No website URLs found in websites.txt.');
    process.exit(1);
  }

  console.log(`Loaded ${urls.length} root site(s).`);

  // Group URLs by normalized domain
  const domainMap: Map<string, Set<string>> = new Map();

  for (const u of urls) {
    const domain = normalizeDomain(u);
    if (!domain) continue;

    if (!domainMap.has(domain)) domainMap.set(domain, new Set());
    domainMap.get(domain)!.add(u);
  }

  // For storing discovered links
  const discovered: Map<string, Set<string>> = new Map();

  // Discover related (same-domain) URLs
  for (const [domain, domainUrls] of domainMap.entries()) {
    console.log(`\n=== SERVICE: ${domain} ===`);
    discovered.set(domain, new Set([...domainUrls]));

    for (const baseUrl of domainUrls) {
      console.log(`\n→ Discovering related pages from: ${baseUrl}`);

      const history: RunAgentResponse = await runAgent({
        userMessage:
          `Scrape ${baseUrl}. Identify ALL internal links belonging to the same service/domain (${domain}). ` +
          `Return them as raw text URLs, nothing else.`,
        tools,
      });

      const last = history.at(-1);
      if (!last || last.role !== 'assistant') {
        console.log('No assistant response captured.');
        continue;
      }

      if (!last) {
        console.log("No assistant response captured.");
        continue;
      }

      const content = (() => {
        const c = last.content;
        if (c == null) return ""; // null or undefined

        if (typeof c === "string") return c;

        if (Array.isArray(c)) {
          return c
            .map((p) => ("text" in p && p.text ? p.text : ""))
            .join("\n");
        }

        return "";
      })();

      const foundUrls = extractUrlsFromResponse(content);
      const sameDomain = foundUrls.filter(
        (link) => normalizeDomain(link) === domain
      );

      console.log(`Found ${sameDomain.length} same-service links.`);

      for (const link of sameDomain) {
        discovered.get(domain)!.add(link);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Extract structured data from each discovered link
  console.log(`BEGINNING FULL EXTRACTION`);

  for (const [domain, linkSet] of discovered.entries()) {
    console.log(`\n### DOMAIN GROUP: ${domain}`);
    const list = [...linkSet];

    console.log(`Total links to extract: ${list.length}`);

    for (const url of list) {
      console.log(`\n=== EXTRACT TARGET ===`);
      console.log(`URL: ${url}`);

      const history: RunAgentResponse = await runAgent({
        userMessage: `Scrape and extract structured info from: ${url}`,
        tools,
      });

      const last = history.at(-1);
      if (last?.role === 'assistant') {
      const content = (() => {
        const c = last.content;
        if (c == null) return "";

        if (typeof c === "string") return c;

        if (Array.isArray(c)) {
          return c
            .map((p) => ("text" in p && p.text ? p.text : ""))
            .join("\n");
        }

        return "";
      })();

      console.log('Result:\n', content);
      } else {
        console.log('No assistant response captured.');
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  console.log('\nAll extraction completed.');
}

main();
