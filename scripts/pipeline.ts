import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runQueryGenerator, saveQueriesToFile } from '../queryGeneratorAgents.js';
import { runSearchAgent } from '../searchAgent.js';
import { runAgent } from '../src/agent.js';
import { resetMessages } from '../src/memory.js';
import { SYSTEM_PROMPT } from '../src/systemPrompt.js';
import { tools } from '../src/tools/index.js';

type SanityBlock = {
  _type: 'block';
  children: Array<{ _type: 'span'; text: string }>;
  markDefs: [];
  style: 'normal';
};

type HoursPeriod = {
  open: { day: number; time: string };
  close: { day: number; time: string };
};

type HoursData = {
  periods: HoursPeriod[];
  weekdayText: string[];
};

type SanityDoc = {
  name: string;
  description: SanityBlock[];
  address: string;
  location: { latitude: number | null; longitude: number | null };
  serviceTypes: Array<{ _id: string }>;
  hoursOfOperation: {
    periods: HoursPeriod[];
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
  extracted: Array<{ url: string; result: SanityDoc; method: 'agent' | 'fallback' }>;
};

const HOURS_LINK_LIMIT = 3;

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

function isNoisyLine(line: string): boolean {
  const lower = line.toLowerCase();
  if (lower.includes('sqs-') || lower.includes('squarespace')) return true;
  if (lower.includes('grid-area') || lower.includes('grid-gutter')) return true;
  if (lower.includes('cell-max-width') || lower.includes('calc(') || lower.includes('var(')) {
    return true;
  }
  if (/\b--[a-z-]+\s*:/.test(lower)) return true;
  if (/\.fe-\w+/.test(lower)) return true;
  if (/[{}]/.test(line)) return true;
  return false;
}

function cleanTextLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  return lines.filter((line) => !isNoisyLine(line));
}

function extractDescriptionFallback(text: string): string {
  const cleaned = cleanTextLines(text).join(' ');
  if (!cleaned) return '';
  const match = cleaned.match(/^(.*?[.!?])\s/);
  if (match) return match[1].slice(0, 240);
  return cleaned.slice(0, 240);
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function toOriginUrl(raw: string): string {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw;
  }
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

function normalizeDay(value: string): { name: string; day: number } | null {
  const key = value.toLowerCase();
  const map: Record<string, { name: string; day: number }> = {
    monday: { name: 'Monday', day: 1 },
    mon: { name: 'Monday', day: 1 },
    tuesday: { name: 'Tuesday', day: 2 },
    tue: { name: 'Tuesday', day: 2 },
    tues: { name: 'Tuesday', day: 2 },
    wednesday: { name: 'Wednesday', day: 3 },
    wed: { name: 'Wednesday', day: 3 },
    thursday: { name: 'Thursday', day: 4 },
    thu: { name: 'Thursday', day: 4 },
    thur: { name: 'Thursday', day: 4 },
    thurs: { name: 'Thursday', day: 4 },
    friday: { name: 'Friday', day: 5 },
    fri: { name: 'Friday', day: 5 },
    saturday: { name: 'Saturday', day: 6 },
    sat: { name: 'Saturday', day: 6 },
    sunday: { name: 'Sunday', day: 7 },
    sun: { name: 'Sunday', day: 7 },
  };

  if (map[key]) return map[key];
  const match = key.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (match && map[match[1]]) return map[match[1]];
  return null;
}

function formatTime(value: string): string {
  if (!/^\d{4}$/.test(value)) return value;
  return `${value.slice(0, 2)}:${value.slice(2)}`;
}

function toPeriodTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number.parseInt(match[1], 10);
  const minute = match[2] ? match[2] : '00';
  const meridiem = match[3];
  if (meridiem) {
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }
  const hourStr = `${hour}`.padStart(2, '0');
  return `${hourStr}${minute}`;
}

function parseOpeningHoursSpecification(spec: Record<string, unknown>): {
  periods: HoursPeriod[];
  weekdayText: string[];
} {
  const periods: HoursPeriod[] = [];
  const weekdayText: string[] = [];

  const daysRaw = spec.dayOfWeek;
  const opens = spec.opens;
  const closes = spec.closes;
  const openTime = toPeriodTime(opens);
  const closeTime = toPeriodTime(closes);

  if (!openTime || !closeTime) return { periods, weekdayText };

  const days = Array.isArray(daysRaw) ? daysRaw : [daysRaw];
  for (const dayValue of days) {
    let dayString: string | null = null;
    if (typeof dayValue === 'string') {
      dayString = dayValue;
    } else if (dayValue && typeof dayValue === 'object') {
      const valueObj = dayValue as Record<string, unknown>;
      if (typeof valueObj['@id'] === 'string') dayString = valueObj['@id'] as string;
      if (!dayString && typeof valueObj['@value'] === 'string') {
        dayString = valueObj['@value'] as string;
      }
    }
    if (!dayString) continue;
    const normalized = normalizeDay(dayString);
    if (!normalized) continue;
    periods.push({
      open: { day: normalized.day, time: openTime },
      close: { day: normalized.day, time: closeTime },
    });
    weekdayText.push(`${normalized.name}: ${formatTime(openTime)} - ${formatTime(closeTime)}`);
  }

  return { periods, weekdayText };
}

function extractHoursFromLd(items: Array<Record<string, unknown>>): HoursData {
  const weekdayText: string[] = [];
  const periods: HoursPeriod[] = [];

  for (const item of items) {
    const openingHours = item.openingHours;
    if (typeof openingHours === 'string') {
      weekdayText.push(openingHours);
    } else if (Array.isArray(openingHours)) {
      for (const entry of openingHours) {
        if (typeof entry === 'string') weekdayText.push(entry);
      }
    }

    const spec = item.openingHoursSpecification;
    if (Array.isArray(spec)) {
      for (const entry of spec) {
        if (!entry || typeof entry !== 'object') continue;
        const parsed = parseOpeningHoursSpecification(entry as Record<string, unknown>);
        periods.push(...parsed.periods);
        weekdayText.push(...parsed.weekdayText);
      }
    } else if (spec && typeof spec === 'object') {
      const parsed = parseOpeningHoursSpecification(spec as Record<string, unknown>);
      periods.push(...parsed.periods);
      weekdayText.push(...parsed.weekdayText);
    }
  }

  return {
    periods,
    weekdayText: dedupeStrings(weekdayText),
  };
}

function extractHoursFromText(text: string): HoursData {
  if (!text) return { periods: [], weekdayText: [] };
  const lines = cleanTextLines(text);
  const dayRegex =
    /\b(mon(day)?|tue(s|sday)?|wed(nesday)?|thu(r|rs|rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b/i;
  const timeRegex = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b/i;
  const closedRegex = /\bclosed\b/i;
  const appointmentRegex = /\bby appointment\b/i;
  const monthRegex =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
  const candidates: string[] = [];

  let grabNext = 0;
  let pendingDay: string | null = null;
  for (const line of lines) {
    const normalized = normalizeWhitespace(line);
    if (!normalized) continue;

    if (monthRegex.test(normalized) && /\b\d{4}\b/.test(normalized)) {
      continue;
    }
    if (/published/i.test(normalized)) {
      continue;
    }

    const hasDay = dayRegex.test(normalized);
    const hasTime = timeRegex.test(normalized);
    const hasClosed = closedRegex.test(normalized) || appointmentRegex.test(normalized);

    if (grabNext > 0) {
      if (hasDay && (hasTime || hasClosed)) {
        candidates.push(normalized);
      } else if (hasDay && !hasTime) {
        pendingDay = normalized;
      } else if (hasTime && pendingDay) {
        candidates.push(`${pendingDay}: ${normalized}`);
        pendingDay = null;
      } else if (hasClosed && pendingDay) {
        candidates.push(`${pendingDay}: ${normalized}`);
        pendingDay = null;
      }
      grabNext -= 1;
    }

    if (/hours/i.test(normalized)) {
      grabNext = 4;
    }

    if (hasDay && (hasTime || hasClosed)) {
      candidates.push(normalized);
      pendingDay = null;
      continue;
    }

    if (hasDay && !hasTime) {
      pendingDay = normalized;
      continue;
    }

    if (hasTime && pendingDay) {
      candidates.push(`${pendingDay}: ${normalized}`);
      pendingDay = null;
    }
  }

  return { periods: [], weekdayText: dedupeStrings(candidates) };
}

function extractHoursFromScraped(scraped: unknown): HoursData {
  const data = scraped && typeof scraped === 'object' ? (scraped as Record<string, any>) : {};
  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  const ldItems = collectLdObjects(metadata.ld_json);
  const fromLd = extractHoursFromLd(ldItems);
  if (fromLd.weekdayText.length || fromLd.periods.length) return fromLd;
  const text = String(data.data?.text || '');
  return extractHoursFromText(text);
}

function getHoursCandidateLinks(
  scraped: unknown,
  baseUrl: string
): Array<{ url: string; score: number }> {
  const data = scraped && typeof scraped === 'object' ? (scraped as Record<string, any>) : {};
  const links = Array.isArray(data.data?.links) ? data.data.links : [];
  let base: URL | null = null;
  try {
    base = new URL(baseUrl);
  } catch {
    base = null;
  }

  const keywords: Array<{ key: string; score: number }> = [
    { key: 'hours', score: 100 },
    { key: 'ourservices', score: 95 },
    { key: 'services', score: 90 },
    { key: 'service', score: 85 },
    { key: 'programs', score: 80 },
    { key: 'program', score: 75 },
    { key: 'contact', score: 70 },
    { key: 'about', score: 60 },
    { key: 'locations', score: 55 },
    { key: 'location', score: 50 },
  ];

  const seen = new Set<string>();
  const candidates: Array<{ url: string; score: number }> = [];

  for (const link of links) {
    const href = typeof link?.href === 'string' ? link.href : '';
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (base && url.origin !== base.origin) continue;
    if (url.href === baseUrl) continue;
    if (seen.has(url.href)) continue;

    const path = `${url.pathname}${url.search}`.toLowerCase();
    const text = typeof link?.text === 'string' ? link.text.toLowerCase() : '';
    let score = 0;
    for (const keyword of keywords) {
      if (path.includes(keyword.key) || text.includes(keyword.key)) {
        score = Math.max(score, keyword.score);
      }
    }

    if (score > 0) {
      seen.add(url.href);
      candidates.push({ url: url.href, score });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
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

function buildSanityDoc(
  scraped: unknown,
  category: string,
  fallbackUrl: string,
  hours: HoursData
): SanityDoc {
  const data = scraped && typeof scraped === 'object' ? (scraped as Record<string, any>) : {};
  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  const ldItems = collectLdObjects(metadata.ld_json);

  const name = firstNonEmpty([metadata.og?.title, metadata.title, extractLdName(ldItems)]);

  const rawDescription = firstNonEmpty([
    metadata.og?.description,
    metadata.description,
    extractLdDescription(ldItems),
  ]);

  const textFallback = extractDescriptionFallback(String(data.data?.text || ''));
  const descriptionText = firstNonEmpty([rawDescription, textFallback]);

  const address = extractLdAddress(ldItems);
  const location = extractLdGeo(ldItems);

  const links = Array.isArray(data.data?.links) ? data.data.links : [];
  const contactFromLinks = extractContactFromLinks(links);

  const website = toOriginUrl(firstNonEmpty([data.final_url, data.url, fallbackUrl]));

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
      periods: hours.periods,
      weekdayText: hours.weekdayText,
    },
    contact: {
      phone: contactFromLinks.phone,
      email: contactFromLinks.email,
      website,
    },
  };
}

function parseAgentOutput(history: Array<{ role?: string; content?: unknown }>): SanityDoc | null {
  const last = [...history].reverse().find((msg) => msg.role === 'assistant' && msg.content);
  if (!last) return null;

  const raw = typeof last.content === 'string' ? last.content : JSON.stringify(last.content || '');

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as SanityDoc;
  } catch {
    const first = raw.indexOf('{');
    const lastIdx = raw.lastIndexOf('}');
    if (first !== -1 && lastIdx !== -1 && lastIdx > first) {
      try {
        const parsed = JSON.parse(raw.slice(first, lastIdx + 1));
        if (parsed && typeof parsed === 'object') return parsed as SanityDoc;
      } catch {
        return null;
      }
    }
  }

  return null;
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
  const extracted: Array<{ url: string; result: SanityDoc; method: 'agent' | 'fallback' }> = [];

  for (const url of urlsToScrape) {
    await resetMessages();
    const agentHistory = await runAgent({
      userMessage: `${SYSTEM_PROMPT}\nCategory: ${category}\nURL: ${url}`,
      tools,
      quiet: true,
    });

    const agentDoc = parseAgentOutput(agentHistory);
    if (agentDoc) {
      sanityDocs.push(agentDoc);
      extracted.push({ url, result: agentDoc, method: 'agent' });
      continue;
    }

    console.warn(`Agent extraction failed for ${url}, using deterministic fallback.`);

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

    let hours = extractHoursFromScraped(parsed);
    if (hours.weekdayText.length === 0 && hours.periods.length === 0) {
      const baseUrl =
        typeof (parsed as Record<string, any>)?.final_url === 'string'
          ? (parsed as Record<string, any>).final_url
          : url;
      const candidates = getHoursCandidateLinks(parsed, baseUrl).slice(0, HOURS_LINK_LIMIT);
      for (const candidate of candidates) {
        const candidateRaw = await scraper.handler({
          userMessage: 'Scrape the provided URL for hours of operation.',
          toolArgs: { url: candidate.url },
        });
        let candidateParsed: unknown;
        try {
          candidateParsed = JSON.parse(candidateRaw);
        } catch {
          candidateParsed = { error: 'Non-JSON scraper output', raw: candidateRaw };
        }
        const candidateHours = extractHoursFromScraped(candidateParsed);
        if (candidateHours.weekdayText.length || candidateHours.periods.length) {
          hours = candidateHours;
          break;
        }
      }
    }

    const fallbackDoc = buildSanityDoc(parsed, category, url, hours);
    sanityDocs.push(fallbackDoc);
    extracted.push({ url, result: fallbackDoc, method: 'fallback' });
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
    extracted,
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
