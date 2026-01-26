import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runQueryGenerator, saveQueriesToFile } from '../queryGeneratorAgents.js';
import { runSearchAgent } from '../searchAgent.js';
import { tools } from '../src/tools/index.js';

type SanityBlock = {
  _type: 'block';
  children: Array<{ _type: 'span'; text: string }>;
  markDefs: [];
  style: 'normal';
};

type SanityDoc = {
  name: string;
  description: SanityBlock[];
  address: string;
  location: { latitude: number | null; longitude: number | null };
  serviceTypes: Array<{ _id: string }>;
  hoursOfOperation: {
    periods: Array<{ open: { day: number; time: string }; close: { day: number; time: string } }>;
    weekdayText: string[];
  };
  contact: { phone: string; email: string; website: string };
};

type PipelineOutput = {
  city: string;
  state: string;
  category: string;
  generated_at: string;
  query_file: string;
  queries: string[];
  search: Array<{ query: string; urls: string[] }>;
  urls: string[];
  scraped: Array<{ url: string; result: unknown }>;
  sanity: SanityDoc[];
  sanity_file: string;
};

function parseIntArg(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeName(input: string): string {
  return input.trim().replace(/\s+/g, '_');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function collectLdObjects(input: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const stack: unknown[] = Array.isArray(input) ? [...input] : [input];

  while (stack.length) {
    const item = stack.pop();
    if (!item) continue;
    if (Array.isArray(item)) {
      stack.push(...item);
      continue;
    }
    if (typeof item === 'object') {
      out.push(item as Record<string, unknown>);
      const graph = (item as Record<string, unknown>)['@graph'];
      if (graph) stack.push(graph);
    }
  }

  return out;
}

function firstNonEmpty(values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function extractLdName(items: Array<Record<string, unknown>>): string {
  for (const item of items) {
    const name = item.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
    if (Array.isArray(name)) {
      const first = name.find((val) => typeof val === 'string' && val.trim());
      if (first) return (first as string).trim();
    }
  }
  return '';
}

function extractLdDescription(items: Array<Record<string, unknown>>): string {
  for (const item of items) {
    const description = item.description;
    if (typeof description === 'string' && description.trim()) return description.trim();
  }
  return '';
}

function extractLdAddress(items: Array<Record<string, unknown>>): string {
  for (const item of items) {
    const address = item.address;
    if (typeof address === 'string' && address.trim()) return address.trim();
    if (address && typeof address === 'object') {
      const addr = address as Record<string, unknown>;
      const parts = [
        addr.streetAddress,
        addr.addressLocality,
        addr.addressRegion,
        addr.postalCode,
        addr.addressCountry,
      ]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean);
      if (parts.length) return parts.join(', ');
    }
  }
  return '';
}

function extractLdGeo(items: Array<Record<string, unknown>>): {
  latitude: number | null;
  longitude: number | null;
} {
  for (const item of items) {
    const geo = item.geo;
    if (geo && typeof geo === 'object') {
      const geoObj = geo as Record<string, unknown>;
      const latitude = toNumber(geoObj.latitude ?? geoObj.lat);
      const longitude = toNumber(geoObj.longitude ?? geoObj.lng ?? geoObj.lon);
      if (latitude !== null || longitude !== null) {
        return { latitude, longitude };
      }
    }
  }
  return { latitude: null, longitude: null };
}

function extractContactFromLinks(links: Array<{ href?: string }>): {
  phone: string;
  email: string;
} {
  let phone = '';
  let email = '';

  for (const link of links) {
    const href = (link.href || '').trim();
    if (!href) continue;
    if (!phone && href.toLowerCase().startsWith('tel:')) {
      phone = href.slice(4).split(/[?#]/)[0].trim();
    }
    if (!email && href.toLowerCase().startsWith('mailto:')) {
      email = href.slice(7).split(/[?#]/)[0].trim();
    }
    if (phone && email) break;
  }

  return { phone, email };
}

function buildSanityDoc(scraped: unknown, category: string, fallbackUrl: string): SanityDoc {
  const data = scraped && typeof scraped === 'object' ? (scraped as Record<string, any>) : {};
  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  const ldItems = collectLdObjects(metadata.ld_json);

  const name = firstNonEmpty([metadata.og?.title, metadata.title, extractLdName(ldItems)]);

  const rawDescription = firstNonEmpty([
    metadata.og?.description,
    metadata.description,
    extractLdDescription(ldItems),
  ]);

  const textFallback = normalizeWhitespace(String(data.data?.text || '')).slice(0, 240);
  const descriptionText = firstNonEmpty([rawDescription, textFallback]);

  const address = extractLdAddress(ldItems);
  const location = extractLdGeo(ldItems);

  const links = Array.isArray(data.data?.links) ? data.data.links : [];
  const contactFromLinks = extractContactFromLinks(links);

  const website = firstNonEmpty([data.final_url, data.url, fallbackUrl]);

  return {
    name: name || website || '',
    description: [
      {
        _type: 'block',
        children: [{ _type: 'span', text: descriptionText }],
        markDefs: [],
        style: 'normal',
      },
    ],
    address: address || '',
    location,
    serviceTypes: [{ _id: category }],
    hoursOfOperation: {
      periods: [],
      weekdayText: [],
    },
    contact: {
      phone: contactFromLinks.phone,
      email: contactFromLinks.email,
      website,
    },
  };
}

async function main() {
  const [city, state, category, perQueryArg, maxUrlsArg] = process.argv.slice(2);

  if (!city || !state || !category) {
    console.error('Usage: tsx scripts/pipeline.ts <city> <state> <category> [perQuery] [maxUrls]');
    process.exit(1);
  }

  const perQuery = parseIntArg(perQueryArg, 3);
  const maxUrls = parseIntArg(maxUrlsArg, 10);
  const outputDir = path.resolve(process.cwd(), 'demo outputs');
  await mkdir(outputDir, { recursive: true });

  const scraper = tools.find((t) => t.definition.function.name === 'scrape_website');
  if (!scraper) {
    throw new Error('scrape_website tool not found.');
  }

  const queries = await runQueryGenerator(city, state, category);
  const queryFile = saveQueriesToFile(city, category, queries, outputDir);

  const searchResults = await runSearchAgent(queries, { perQuery });

  const seen = new Set<string>();
  const orderedUrls: string[] = [];
  for (const result of searchResults) {
    for (const url of result.urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      orderedUrls.push(url);
    }
  }

  const urlsToScrape = orderedUrls.slice(0, maxUrls);
  const scraped: Array<{ url: string; result: unknown }> = [];
  const sanityDocs: SanityDoc[] = [];

  for (const url of urlsToScrape) {
    const raw = await scraper.handler({
      userMessage: 'Scrape the provided URL.',
      toolArgs: { url },
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { error: 'Non-JSON scraper output', raw };
    }
    scraped.push({ url, result: parsed });
    sanityDocs.push(buildSanityDoc(parsed, category, url));
  }

  const sanityFile = path.join(outputDir, `${safeName(city)}_${safeName(category)}_sanity.json`);
  await writeFile(sanityFile, JSON.stringify(sanityDocs, null, 2), 'utf-8');

  const output: PipelineOutput = {
    city,
    state,
    category,
    generated_at: new Date().toISOString(),
    query_file: queryFile,
    queries,
    search: searchResults,
    urls: urlsToScrape,
    scraped,
    sanity: sanityDocs,
    sanity_file: sanityFile,
  };

  const outputFile = path.join(outputDir, `${safeName(city)}_${safeName(category)}_pipeline.json`);
  await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`Saved queries to ${queryFile}`);
  console.log(`Saved pipeline output to ${outputFile}`);
  console.log(`Saved sanity output to ${sanityFile}`);
  console.log(JSON.stringify(sanityDocs, null, 2));
  console.log(`Scraped ${urlsToScrape.length} URLs`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
