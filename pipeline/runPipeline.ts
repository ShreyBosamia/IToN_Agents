import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runAgent } from '../src/agent.ts';
import { runQueryGenerator, saveQueriesToFile } from '../src/agents/queryGenerator.ts';
import { runSearchAgent } from '../src/agents/searchAgent.ts';
import { SYSTEM_PROMPT } from '../src/systemPrompt.ts';
import { tools } from '../src/tools/index.ts';
import {
  scrapeWithProviders,
  type ScrapeLink,
  type ScrapePayload,
  type ScrapeProviderName,
} from '../src/tools/scrapeWebsite.ts';

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

export type PipelineOutput = {
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

export type PipelineRunResult = {
  output: PipelineOutput;
  outputFile: string;
  sanityFile: string;
};

type PipelineOptions = {
  city: string;
  state: string;
  category: string;
  perQuery?: number;
  maxUrls?: number;
  outputDir?: string;
};

const HOURS_LINK_LIMIT = 3;
const DEFAULT_TARGET_PAGE_LIMIT = 5;
const NULLISH_STRING_VALUES = new Set([
  'null',
  '"null"',
  "'null'",
  'undefined',
  'none',
  'n/a',
  'na',
  'not available',
  'unknown',
]);
const STREET_ADDRESS_REGEX =
  /\b\d{1,6}\s+(?:[A-Za-z0-9#.'’&/-]+\s+){0,10}(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Circle|Cir|Terrace|Ter)\b/gi;
const STREET_ADDRESS_WITH_CITY_REGEX =
  /\d{1,6}\s+(?:[A-Za-z0-9#.'’&/-]+\s+){0,10}(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Circle|Cir|Terrace|Ter)\b(?:,\s*[A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Za-z .'-]+)(?:\s+\d{5}(?:-\d{4})?)?)?/i;
const CITY_STATE_LINE_REGEX =
  /\b[a-z .'-]+,\s*(?:[a-z]{2}|[a-z .'-]+)(?:\s+\d{5}(?:-\d{4})?)?\b/i;

export type PageIntent =
  | 'home'
  | 'contact'
  | 'hours'
  | 'location'
  | 'services'
  | 'program'
  | 'about'
  | 'faq'
  | 'general';

export type RankedPageLink = {
  url: string;
  normalizedUrl: string;
  intent: PageIntent;
  score: number;
  anchorText: string;
  rel: string;
};

export type CandidateFact<T> = {
  value: T;
  sourceUrl: string;
  intent: PageIntent;
  provider: ScrapeProviderName;
  confidence: number;
};

export type PageEvidence = {
  url: string;
  finalUrl: string;
  intent: PageIntent;
  provider: ScrapeProviderName;
  fetchedAt: string;
  title: string;
  description: string;
  text: string;
  links: ScrapeLink[];
  nameCandidates: Array<CandidateFact<string>>;
  descriptionCandidates: Array<CandidateFact<string>>;
  addressCandidates: Array<CandidateFact<string>>;
  geoCandidates: Array<CandidateFact<{ latitude: number | null; longitude: number | null }>>;
  phoneCandidates: Array<CandidateFact<string>>;
  emailCandidates: Array<CandidateFact<string>>;
  websiteCandidates: Array<CandidateFact<string>>;
  hoursCandidates: Array<CandidateFact<HoursData>>;
  serviceTypeCandidates: Array<CandidateFact<string>>;
};

type RetrievalBundle = {
  root: ScrapePayload;
  candidates: RankedPageLink[];
  pages: PageEvidence[];
  sanityDoc: SanityDoc;
};

function parseIntArg(value: number | undefined, fallback: number): number {
  if (!value) return fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function safeName(input: string): string {
  return input.trim().replace(/\s+/g, '_');
}

function normalizeWhitespace(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim();
}

function sanitizeScalarString(text: unknown): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return '';
  const key = normalized.toLowerCase().replace(/^["']+|["']+$/g, '');
  if (NULLISH_STRING_VALUES.has(key)) return '';
  return normalized;
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

function normalizePageUrl(raw: string): string {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function normalizeStringKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizePhoneKey(value: string): string {
  return value.replace(/\D+/g, '');
}

function isPhoneShortCode(value: string): boolean {
  const digits = normalizePhoneKey(value);
  return /^(211|311|411|511|611|711|811|911)$/.test(digits);
}

function isLikelyPhoneNumber(value: string): boolean {
  const digits = normalizePhoneKey(value);
  const localDigits =
    digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : '';

  return /^[2-9]\d{2}[2-9]\d{6}$/.test(localDigits);
}

function phoneQuality(value: string): number {
  const normalized = sanitizeScalarString(value);
  if (!normalized) return 0;
  if (isLikelyPhoneNumber(normalized)) return 3;
  if (isPhoneShortCode(normalized)) return 1;
  return 0;
}

function sanitizePhoneValue(value: unknown): string {
  const normalized = sanitizeScalarString(value);
  if (!normalized) return '';
  return phoneQuality(normalized) > 0 ? normalized : '';
}

function emailQuality(value: string): number {
  const normalized = sanitizeScalarString(value).toLowerCase();
  if (!normalized) return 0;
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized) ? 3 : 0;
}

function sanitizeEmailValue(value: unknown): string {
  const normalized = sanitizeScalarString(value).toLowerCase();
  return emailQuality(normalized) > 0 ? normalized : '';
}

function urlDepth(raw: string): number {
  try {
    return new URL(raw).pathname.split('/').filter(Boolean).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function pathSignalsFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return decodeURIComponent(`${url.pathname} ${url.search}`).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function isNewsLikePath(raw: string): boolean {
  return /(^|\/)(news|blog|stories|story|events?|calendar|press|article|updates?)(\/|$)/i.test(
    pathSignalsFromUrl(raw)
  );
}

function sourceRelationScore(sourceUrl: string, targetUrl: string): number {
  const source = sanitizeWebsiteValue(sourceUrl);
  const target = sanitizeWebsiteValue(targetUrl);
  if (!source || !target) return 0;
  if (normalizePageUrl(source) === normalizePageUrl(target)) return 60;

  try {
    const sourceParsed = new URL(source);
    const targetParsed = new URL(target);
    if (sourceParsed.origin !== targetParsed.origin) return 0;

    const sourcePath = sourceParsed.pathname.replace(/\/+$/, '') || '/';
    const targetPath = targetParsed.pathname.replace(/\/+$/, '') || '/';
    if (sourcePath === targetPath) return 55;
    if (targetPath !== '/' && sourcePath.startsWith(`${targetPath}/`)) return 35;
    if (sourcePath !== '/' && targetPath.startsWith(`${sourcePath}/`)) return 28;
    if (sourcePath === '/') return targetPath === '/' ? 35 : 12;
    return 8;
  } catch {
    return 0;
  }
}

function websiteQuality(value: string, fallbackUrl = ''): number {
  const normalized = sanitizeScalarString(value);
  if (!normalized) return 0;

  let candidate: URL;
  try {
    candidate = new URL(normalized);
  } catch {
    return 0;
  }

  if (!['http:', 'https:'].includes(candidate.protocol)) return 0;

  let score = 35;
  const pathSignals = decodeURIComponent(`${candidate.pathname} ${candidate.search}`).toLowerCase();
  const depth = urlDepth(candidate.toString());

  if (depth === 0) score += 18;
  else score += Math.max(0, 16 - depth * 3);

  if (fallbackUrl) {
    try {
      const fallback = new URL(fallbackUrl);
      if (candidate.origin === fallback.origin) score += 15;
    } catch {
      // Ignore invalid fallback URL.
    }
  }

  if (isNewsLikePath(pathSignals)) {
    score -= 35;
  }
  if (candidate.search) score -= 5;
  if (candidate.hash) score -= 2;

  return Math.max(0, score);
}

function sanitizeWebsiteValue(value: unknown): string {
  const normalized = sanitizeScalarString(value);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return normalizePageUrl(url.toString());
  } catch {
    return '';
  }
}

function countRegexMatches(value: string, regex: RegExp): number {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  return Array.from(value.matchAll(new RegExp(regex.source, flags))).length;
}

function sanitizeAddressValue(value: unknown): string {
  const normalized = sanitizeScalarString(value);
  if (!normalized) return '';

  const streetMatchCount = countRegexMatches(normalized, STREET_ADDRESS_REGEX);
  const cityStateCount = countRegexMatches(normalized, CITY_STATE_LINE_REGEX);
  if (streetMatchCount === 0) return '';
  if (streetMatchCount > 1 || cityStateCount > 1) return '';
  if (/(?:\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4}\s+-\s+)+\d{1,6}\s/i.test(normalized)) return '';
  if (normalized.length > 180) return '';

  const direct = normalized.match(STREET_ADDRESS_WITH_CITY_REGEX);
  return normalizeWhitespace(direct?.[0] || normalized);
}

function normalizeAddressKey(value: string): string {
  return normalizeStringKey(sanitizeAddressValue(value))
    .replace(/\b(ste|suite|unit|floor)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressQuality(value: string): number {
  const normalized = sanitizeAddressValue(value);
  if (!normalized) return 0;

  let score = 20;
  const streetMatches = normalized.match(STREET_ADDRESS_REGEX) || [];

  if (streetMatches.length > 0) score += 25;
  if (/,?\s*[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?/i.test(normalized)) score += 25;
  if (streetMatches.length > 1) score -= 35;
  if (normalized.length > 140) score -= 10;

  return Math.max(0, score);
}

function hoursQuality(hours: HoursData | undefined | null): number {
  if (!hours) return 0;
  const periods = Array.isArray(hours.periods) ? hours.periods.length : 0;
  const weekdayText = Array.isArray(hours.weekdayText)
    ? hours.weekdayText.map((entry) => sanitizeScalarString(entry)).filter(Boolean)
    : [];
  return periods * 5 + weekdayText.length * 3;
}

function sourceUrlScoreAdjustment(sourceUrl: string): number {
  const normalized = sanitizeScalarString(sourceUrl);
  if (!normalized) return 0;

  let adjustment = 0;
  const depth = urlDepth(normalized);
  if (Number.isFinite(depth)) adjustment -= Math.max(0, depth - 2) * 4;

  try {
    const url = new URL(normalized);
    const pathSignals = decodeURIComponent(`${url.pathname} ${url.search}`).toLowerCase();
    if (isNewsLikePath(pathSignals)) {
      adjustment -= 30;
    }
  } catch {
    return adjustment;
  }

  return adjustment;
}

function normalizeHoursKey(hours: HoursData): string {
  const weekdayText = dedupeStrings(hours.weekdayText).join('|');
  if (weekdayText) return normalizeStringKey(weekdayText);
  return JSON.stringify(hours.periods);
}

function cleanNameCandidate(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';
  const pipe = normalized.split('|').map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (pipe.length > 1 && pipe[0].length >= 4) return pipe[0];
  const dash = normalized.split(' - ').map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (dash.length > 1 && dash[0].length >= 4) return dash[0];
  return normalized;
}

function normalizeServiceLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function intentPriority(intent: PageIntent): number {
  const order: Record<PageIntent, number> = {
    contact: 1,
    hours: 2,
    location: 3,
    services: 4,
    program: 5,
    about: 6,
    faq: 7,
    home: 8,
    general: 9,
  };
  return order[intent];
}

function fieldConfidence(
  field: 'name' | 'description' | 'address' | 'geo' | 'phone' | 'email' | 'website' | 'hours' | 'service',
  intent: PageIntent
): number {
  const matrix: Record<typeof field, Record<PageIntent, number>> = {
    name: {
      home: 100,
      contact: 70,
      hours: 40,
      location: 65,
      services: 80,
      program: 75,
      about: 85,
      faq: 45,
      general: 50,
    },
    description: {
      home: 100,
      contact: 45,
      hours: 35,
      location: 45,
      services: 85,
      program: 80,
      about: 90,
      faq: 50,
      general: 55,
    },
    address: {
      home: 55,
      contact: 100,
      hours: 45,
      location: 95,
      services: 75,
      program: 85,
      about: 60,
      faq: 55,
      general: 50,
    },
    geo: {
      home: 55,
      contact: 95,
      hours: 40,
      location: 100,
      services: 70,
      program: 75,
      about: 55,
      faq: 40,
      general: 45,
    },
    phone: {
      home: 60,
      contact: 100,
      hours: 45,
      location: 90,
      services: 80,
      program: 75,
      about: 55,
      faq: 50,
      general: 50,
    },
    email: {
      home: 60,
      contact: 100,
      hours: 40,
      location: 85,
      services: 75,
      program: 70,
      about: 55,
      faq: 45,
      general: 45,
    },
    website: {
      home: 100,
      contact: 80,
      hours: 45,
      location: 75,
      services: 70,
      program: 65,
      about: 60,
      faq: 40,
      general: 50,
    },
    hours: {
      home: 45,
      contact: 65,
      hours: 100,
      location: 60,
      services: 85,
      program: 90,
      about: 40,
      faq: 75,
      general: 45,
    },
    service: {
      home: 60,
      contact: 35,
      hours: 20,
      location: 35,
      services: 100,
      program: 95,
      about: 50,
      faq: 35,
      general: 45,
    },
  };

  return matrix[field][intent];
}

function isJunkLink(raw: string): boolean {
  const lower = raw.toLowerCase();
  if (
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('#')
  ) {
    return true;
  }

  if (
    lower.includes('facebook.com') ||
    lower.includes('instagram.com') ||
    lower.includes('twitter.com') ||
    lower.includes('x.com') ||
    lower.includes('linkedin.com') ||
    lower.includes('youtube.com')
  ) {
    return true;
  }

  return /\.(pdf|jpg|jpeg|png|gif|webp|svg|mp4|mp3|css|js|xml|zip|ics)(\?|#|$)/i.test(lower);
}

function scoreIntentSignals(
  intent: PageIntent,
  pathSignals: string,
  textSignals: string,
  relSignals: string
): number {
  const rules: Record<PageIntent, string[]> = {
    home: [],
    contact: ['contact', 'find us', 'reach us', 'staff', 'team', 'directory'],
    hours: ['hours', 'schedule', 'open', 'times', 'when'],
    location: ['location', 'locations', 'visit', 'directions', 'map', 'where'],
    services: ['services', 'service', 'assistance', 'resources', 'what we do', 'get help'],
    program: [
      'program',
      'programs',
      'pantry',
      'shelter',
      'meal',
      'cafe',
      'clinic',
      'showers',
      'wellness',
      'children',
      'family',
      'housing',
    ],
    about: ['about', 'mission', 'history', 'who we are'],
    faq: ['faq', 'frequently asked', 'questions'],
    general: [],
  };

  let score = 0;
  for (const keyword of rules[intent]) {
    if (pathSignals.includes(keyword)) score += 65;
    if (textSignals.includes(keyword)) score += 35;
    if (relSignals.includes(keyword)) score += 15;
  }

  if (intent === 'hours' && textSignals.includes('faq')) score += 20;
  if (intent === 'location' && textSignals.includes('contact')) score += 10;
  if (intent === 'contact' && pathSignals.includes('about')) score -= 15;

  return score;
}

export function rankTargetPageLinks(
  links: ScrapeLink[],
  baseUrl: string,
  limit = DEFAULT_TARGET_PAGE_LIMIT
): RankedPageLink[] {
  let base: URL | null = null;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const bestByUrl = new Map<string, RankedPageLink>();

  for (const link of links) {
    const rawHref = typeof link.href === 'string' ? link.href.trim() : '';
    if (!rawHref || isJunkLink(rawHref)) continue;

    let resolved: URL;
    try {
      resolved = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }

    if (resolved.origin !== base.origin) continue;
    const normalizedUrl = normalizePageUrl(resolved.toString());
    if (!normalizedUrl || normalizedUrl === normalizePageUrl(baseUrl)) continue;

    const pathSignals = decodeURIComponent(`${resolved.pathname} ${resolved.search}`).toLowerCase();
    const textSignals = normalizeWhitespace(link.text || '').toLowerCase();
    const relSignals = normalizeWhitespace(link.rel || '').toLowerCase();

    if (
      /donate|volunteer|privacy|terms|login|sign-?in|subscribe|calendar|event|news|blog|story|stories|article|press|media|updates?/i.test(
        `${pathSignals} ${textSignals}`
      )
    ) {
      continue;
    }

    let bestIntent: PageIntent = 'general';
    let bestScore = 0;
    for (const intent of ['contact', 'hours', 'location', 'services', 'program', 'about', 'faq'] as const) {
      const score = scoreIntentSignals(intent, pathSignals, textSignals, relSignals);
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    if (bestScore <= 0) continue;

    const depth = resolved.pathname.split('/').filter(Boolean).length;
    const finalScore = bestScore + Math.max(0, 20 - depth * 4);
    const candidate: RankedPageLink = {
      url: resolved.toString(),
      normalizedUrl,
      intent: bestIntent,
      score: finalScore,
      anchorText: normalizeWhitespace(link.text || ''),
      rel: normalizeWhitespace(link.rel || ''),
    };

    const current = bestByUrl.get(normalizedUrl);
    if (!current || candidate.score > current.score) {
      bestByUrl.set(normalizedUrl, candidate);
    }
  }

  const perIntentLimit: Record<PageIntent, number> = {
    home: 0,
    contact: 1,
    hours: 1,
    location: 2,
    services: 1,
    program: 2,
    about: 1,
    faq: 1,
    general: 0,
  };

  const intentCounts = new Map<PageIntent, number>();
  const picked: RankedPageLink[] = [];
  const sorted = Array.from(bestByUrl.values()).sort((a, b) => b.score - a.score);
  for (const candidate of sorted) {
    const current = intentCounts.get(candidate.intent) ?? 0;
    if (current >= perIntentLimit[candidate.intent]) continue;
    picked.push(candidate);
    intentCounts.set(candidate.intent, current + 1);
    if (picked.length >= limit) break;
  }

  return picked;
}

function extractContactCandidatesFromLinks(links: Array<{ href?: string }>): {
  phones: string[];
  emails: string[];
} {
  const phones: string[] = [];
  const emails: string[] = [];

  for (const link of links) {
    const href = (link.href || '').trim();
    if (!href) continue;
    if (href.toLowerCase().startsWith('tel:')) {
      phones.push(href.slice(4).split(/[?#]/)[0].trim());
    }
    if (href.toLowerCase().startsWith('mailto:')) {
      emails.push(href.slice(7).split(/[?#]/)[0].trim());
    }
  }

  return {
    phones: dedupeStrings(phones).filter(isLikelyPhoneNumber),
    emails: dedupeStrings(emails).filter((email) => emailQuality(email) > 0),
  };
}

function extractPhonesFromText(text: string): string[] {
  const matches = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g) || [];
  return dedupeStrings(matches.map((match) => normalizeWhitespace(match))).filter(isLikelyPhoneNumber);
}

function extractEmailsFromText(text: string): string[] {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return dedupeStrings(matches.map((match) => match.toLowerCase())).filter(
    (email) => emailQuality(email) > 0
  );
}

function extractAddressCandidatesFromText(text: string): string[] {
  const lines = cleanTextLines(text);
  const candidates: string[] = [];
  const streetRegex = new RegExp(STREET_ADDRESS_REGEX.source, 'i');
  const labelRegex = /^(address|visit us|find us|location|our location)s?:?$/i;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (streetRegex.test(line)) {
      const match = line.match(STREET_ADDRESS_WITH_CITY_REGEX);
      candidates.push(normalizeWhitespace(match?.[0] || line));
      if (i < lines.length - 1 && CITY_STATE_LINE_REGEX.test(lines[i + 1])) {
        candidates.push(`${normalizeWhitespace(match?.[0] || line)}, ${lines[i + 1]}`);
      }
      continue;
    }

    if (labelRegex.test(line) && i < lines.length - 1) {
      const next = lines[i + 1];
      const nextMatch = next.match(STREET_ADDRESS_WITH_CITY_REGEX);
      const nextBase = normalizeWhitespace(nextMatch?.[0] || next);
      const nextTwo = i < lines.length - 2 ? `${nextBase}, ${lines[i + 2]}` : nextBase;
      if (streetRegex.test(next)) {
        candidates.push(nextBase);
        if (CITY_STATE_LINE_REGEX.test(lines[i + 2] || '')) candidates.push(nextTwo);
      }
    }
  }

  const fullMatches = text.match(
    new RegExp(STREET_ADDRESS_WITH_CITY_REGEX.source, 'g')
  ) || [];

  candidates.push(...fullMatches.map((match) => normalizeWhitespace(match)));
  return dedupeStrings(candidates.map((value) => sanitizeAddressValue(value)).filter(Boolean));
}

function extractServiceLabelsFromPage(
  title: string,
  text: string,
  pageUrl: string
): string[] {
  const signals = `${title}\n${text}\n${pageUrl}`.toLowerCase();
  const labels: string[] = [];
  const keywords: Array<[string, string[]]> = [
    ['food_pantry', ['food pantry', 'pantry']],
    ['food_bank', ['food bank']],
    ['shelter', ['shelter']],
    ['housing', ['housing']],
    ['advocacy', ['advocacy']],
    ['wellness', ['wellness']],
    ['showers', ['showers', 'shower']],
    ['laundry', ['laundry']],
    ['meal_program', ['meal', 'cafe', 'kitchen']],
    ['clinic', ['clinic', 'medical']],
    ['children_services', ['children', 'child']],
    ['family_services', ['family']],
  ];

  for (const [label, patterns] of keywords) {
    if (patterns.some((pattern) => signals.includes(pattern))) {
      labels.push(label);
    }
  }

  return dedupeStrings(labels.map(normalizeServiceLabel));
}

function pushCandidate<T>(
  target: Array<CandidateFact<T>>,
  value: T | null | undefined,
  sourceUrl: string,
  intent: PageIntent,
  provider: ScrapeProviderName,
  confidence: number,
  isEmpty: (value: T) => boolean
) {
  if (value === null || value === undefined || isEmpty(value)) return;
  target.push({ value, sourceUrl, intent, provider, confidence });
}

export function collectPageEvidenceFromScrapedPage(
  scraped: ScrapePayload,
  intent: PageIntent,
  category: string
): PageEvidence {
  const metadata = (scraped.metadata ?? {}) as NonNullable<ScrapePayload['metadata']>;
  const ldItems = collectLdObjects(metadata.ld_json);
  const text = String(scraped.data?.text || '');
  const links = Array.isArray(scraped.data?.links) ? scraped.data.links : [];
  const finalUrl = firstNonEmpty([scraped.final_url, scraped.url]);
  const website = normalizePageUrl(finalUrl);
  const title = cleanNameCandidate(firstNonEmpty([metadata.og?.title, metadata.title]));
  const rawDescription = firstNonEmpty([
    metadata.og?.description,
    metadata.description,
    extractLdDescription(ldItems),
  ]);
  const description = firstNonEmpty([rawDescription, extractDescriptionFallback(text)]);
  const ldAddress = extractLdAddress(ldItems);
  const textAddresses = extractAddressCandidatesFromText(text);
  const geo = extractLdGeo(ldItems);
  const linkContacts = extractContactCandidatesFromLinks(links);
  const textPhones = extractPhonesFromText(text);
  const textEmails = extractEmailsFromText(text);
  const hours = extractHoursFromScraped(scraped);
  const services = extractServiceLabelsFromPage(title, text, finalUrl);

  const evidence: PageEvidence = {
    url: scraped.url,
    finalUrl,
    intent,
    provider: scraped.provider,
    fetchedAt: scraped.fetched_at,
    title,
    description,
    text,
    links,
    nameCandidates: [],
    descriptionCandidates: [],
    addressCandidates: [],
    geoCandidates: [],
    phoneCandidates: [],
    emailCandidates: [],
    websiteCandidates: [],
    hoursCandidates: [],
    serviceTypeCandidates: [],
  };

  pushCandidate(
    evidence.nameCandidates,
    sanitizeScalarString(title || extractLdName(ldItems)),
    finalUrl,
    intent,
    scraped.provider,
    fieldConfidence('name', intent),
    (value) => !normalizeWhitespace(value)
  );
  pushCandidate(
    evidence.descriptionCandidates,
    sanitizeScalarString(description),
    finalUrl,
    intent,
    scraped.provider,
    fieldConfidence('description', intent),
    (value) => !normalizeWhitespace(value)
  );
  pushCandidate(
    evidence.addressCandidates,
    sanitizeAddressValue(ldAddress),
    finalUrl,
    intent,
    scraped.provider,
    fieldConfidence('address', intent) + 20,
    (value) => !normalizeWhitespace(value)
  );
  for (const address of textAddresses) {
    const completenessBonus = /,\s*[A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Za-z .'-]+)/.test(address)
      ? 12
      : 0;
    pushCandidate(
      evidence.addressCandidates,
      sanitizeAddressValue(address),
      finalUrl,
      intent,
      scraped.provider,
      fieldConfidence('address', intent) + completenessBonus,
      (value) => !normalizeWhitespace(value)
    );
  }
  pushCandidate(
    evidence.geoCandidates,
    geo,
    finalUrl,
    intent,
    scraped.provider,
    fieldConfidence('geo', intent),
    (value) => value.latitude === null && value.longitude === null
  );
  for (const phone of [...linkContacts.phones, ...textPhones]) {
    pushCandidate(
      evidence.phoneCandidates,
      sanitizePhoneValue(phone),
      finalUrl,
      intent,
      scraped.provider,
      fieldConfidence('phone', intent),
      (value) => !normalizeWhitespace(value)
    );
  }
  for (const email of [...linkContacts.emails, ...textEmails]) {
    pushCandidate(
      evidence.emailCandidates,
      sanitizeEmailValue(email),
      finalUrl,
      intent,
      scraped.provider,
      fieldConfidence('email', intent),
      (value) => !normalizeWhitespace(value)
    );
  }
  pushCandidate(
      evidence.websiteCandidates,
    sanitizeWebsiteValue(website),
    finalUrl,
    intent,
    scraped.provider,
    fieldConfidence('website', intent),
    (value) => !normalizeWhitespace(value)
  );
  pushCandidate(
    evidence.hoursCandidates,
    hours,
    finalUrl,
    intent,
    scraped.provider,
    fieldConfidence('hours', intent),
    (value) => value.periods.length === 0 && value.weekdayText.length === 0
  );
  for (const service of services) {
    if (service === normalizeServiceLabel(category)) continue;
    pushCandidate(
      evidence.serviceTypeCandidates,
      service,
      finalUrl,
      intent,
      scraped.provider,
      fieldConfidence('service', intent),
      (value) => !normalizeWhitespace(value)
    );
  }

  return evidence;
}

type CandidatePickOptions<T> = {
  extraScore?: (candidate: CandidateFact<T>) => number;
  disqualify?: (candidate: CandidateFact<T>) => boolean;
};

function pickBestCandidate<T>(
  candidates: Array<CandidateFact<T>>,
  normalize: (value: T) => string,
  options: CandidatePickOptions<T> = {}
): CandidateFact<T> | null {
  const eligible = options.disqualify
    ? candidates.filter((candidate) => !options.disqualify?.(candidate))
    : candidates;
  if (eligible.length === 0) return null;

  const counts = new Map<string, number>();
  for (const candidate of eligible) {
    const key = normalize(candidate.value);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const scored = eligible
    .map((candidate) => {
      const key = normalize(candidate.value);
      const repeatCount = counts.get(key) ?? 1;
      return {
        candidate,
        totalScore:
          candidate.confidence +
          (repeatCount - 1) * 15 +
          sourceUrlScoreAdjustment(candidate.sourceUrl) +
          (options.extraScore?.(candidate) ?? 0),
      };
    })
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (intentPriority(a.candidate.intent) !== intentPriority(b.candidate.intent)) {
        return intentPriority(a.candidate.intent) - intentPriority(b.candidate.intent);
      }
      return a.candidate.sourceUrl.localeCompare(b.candidate.sourceUrl);
    });

  return scored[0]?.candidate ?? null;
}

function rootAggregateSignals(rootPage: PageEvidence | undefined, fallbackUrl: string): boolean {
  const signals = [
    sanitizeScalarString(rootPage?.title),
    sanitizeScalarString(rootPage?.description),
    sanitizeWebsiteValue(rootPage?.finalUrl || ''),
    sanitizeWebsiteValue(fallbackUrl),
  ]
    .join(' ')
    .toLowerCase();

  const aggregatePattern =
    /\b(services|programs|locations|resources|shelters|find support|find help|directory|list|schedules?)\b/;
  const specificPattern = /\b(contact|about|visit|hours|location)\b/;
  return aggregatePattern.test(signals) && !specificPattern.test(signals);
}

function websiteSelectionQuality(value: string, targetUrl: string): number {
  const normalized = sanitizeWebsiteValue(value);
  if (!normalized) return 0;

  let score = websiteQuality(normalized, targetUrl);
  score += sourceRelationScore(normalized, targetUrl);
  if (normalizePageUrl(normalized) === normalizePageUrl(targetUrl)) score += 55;
  if (isNewsLikePath(normalized)) score -= 40;
  return score;
}

type PreferredField = 'address' | 'contact' | 'hours';

function pageFieldIntentWeight(field: PreferredField, intent: PageIntent): number {
  const weights: Record<PreferredField, Record<PageIntent, number>> = {
    address: {
      contact: 40,
      home: 28,
      services: 26,
      about: 22,
      location: 18,
      program: 14,
      hours: 8,
      faq: 6,
      general: 4,
    },
    contact: {
      contact: 45,
      home: 30,
      about: 24,
      services: 20,
      location: 14,
      program: 10,
      hours: 8,
      faq: 6,
      general: 4,
    },
    hours: {
      hours: 40,
      contact: 20,
      home: 18,
      services: 18,
      program: 16,
      location: 12,
      faq: 10,
      about: 6,
      general: 4,
    },
  };

  return weights[field][intent];
}

function pageFieldSignalCount(page: PageEvidence, field: PreferredField): number {
  if (field === 'address') return page.addressCandidates.length;
  if (field === 'contact') {
    let count = 0;
    if (page.phoneCandidates.length) count += 1;
    if (page.emailCandidates.length) count += 1;
    return count;
  }
  return page.hoursCandidates.length;
}

function pickPreferredPageForField(
  pages: PageEvidence[],
  field: PreferredField,
  targetUrl: string,
  aggregateRoot: boolean
): PageEvidence | null {
  const eligible = pages.filter((page) => pageFieldSignalCount(page, field) > 0);
  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    const scoreFor = (page: PageEvidence) => {
      let score =
        pageFieldIntentWeight(field, page.intent) +
        sourceRelationScore(page.finalUrl, targetUrl) +
        pageFieldSignalCount(page, field) * 8;

      if (field === 'contact' && page.phoneCandidates.length && page.emailCandidates.length) {
        score += 12;
      }
      if (field === 'address' && page.phoneCandidates.length) score += 6;
      if (field === 'hours' && page.phoneCandidates.length) score += 4;

      if (aggregateRoot && (page.intent === 'location' || page.intent === 'program')) {
        score -= field === 'hours' ? 6 : 14;
      }
      if (isNewsLikePath(page.finalUrl)) score -= 35;
      return score;
    };

    const scoreDiff = scoreFor(b) - scoreFor(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.finalUrl.localeCompare(b.finalUrl);
  })[0] ?? null;
}

export function buildSanityDocFromEvidence(
  pages: PageEvidence[],
  category: string,
  fallbackUrl: string
): SanityDoc {
  const normalizedFallbackUrl = sanitizeWebsiteValue(fallbackUrl);
  const rootPage =
    pages.find((page) => sourceRelationScore(page.finalUrl, normalizedFallbackUrl) >= 55) ??
    pages.find((page) => page.intent === 'home') ??
    pages[0];
  const aggregateRoot = rootAggregateSignals(rootPage, normalizedFallbackUrl);
  const preferredAddressPage = pickPreferredPageForField(
    pages,
    'address',
    normalizedFallbackUrl,
    aggregateRoot
  );
  const preferredContactPage = pickPreferredPageForField(
    pages,
    'contact',
    normalizedFallbackUrl,
    aggregateRoot
  );
  const preferredHoursPage = pickPreferredPageForField(
    pages,
    'hours',
    normalizedFallbackUrl,
    aggregateRoot
  );
  const allNameCandidates = pages.flatMap((page) => page.nameCandidates);
  const allDescriptionCandidates = pages.flatMap((page) => page.descriptionCandidates);
  const allAddressCandidates = pages.flatMap((page) => page.addressCandidates);
  const allGeoCandidates = pages.flatMap((page) => page.geoCandidates);
  const allPhoneCandidates = pages.flatMap((page) => page.phoneCandidates);
  const allEmailCandidates = pages.flatMap((page) => page.emailCandidates);
  const allWebsiteCandidates = pages.flatMap((page) => page.websiteCandidates);
  const allHoursCandidates = pages.flatMap((page) => page.hoursCandidates);
  const allServiceTypeCandidates = pages.flatMap((page) => page.serviceTypeCandidates);
  const addressRepeatCounts = new Map<string, number>();
  for (const candidate of allAddressCandidates) {
    const key = normalizeAddressKey(candidate.value);
    if (!key) continue;
    addressRepeatCounts.set(key, (addressRepeatCounts.get(key) ?? 0) + 1);
  }
  const fallbackAddressKeys = new Set(
    allAddressCandidates
      .filter((candidate) => sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl) >= 28)
      .map((candidate) => normalizeAddressKey(candidate.value))
      .filter(Boolean)
  );

  const name =
    pickBestCandidate(allNameCandidates, normalizeStringKey, {
      extraScore: (candidate) => sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl),
    })?.value || '';
  const descriptionText =
    pickBestCandidate(allDescriptionCandidates, normalizeStringKey, {
      extraScore: (candidate) => sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl),
    })?.value || '';
  const selectedAddressCandidate = pickBestCandidate(allAddressCandidates, normalizeAddressKey, {
    extraScore: (candidate) => {
      const key = normalizeAddressKey(candidate.value);
      const repeatCount = addressRepeatCounts.get(key) ?? 1;
      let score = sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl);
      if (
        preferredAddressPage &&
        normalizePageUrl(candidate.sourceUrl) === normalizePageUrl(preferredAddressPage.finalUrl)
      ) {
        score += 28;
      }
      if (candidate.intent === 'contact') score += 10;
      if (candidate.intent === 'location') score -= aggregateRoot ? 15 : 5;
      if (candidate.intent === 'program') score -= aggregateRoot ? 10 : 2;
      if (repeatCount > 1) score += 12;
      if (candidate.intent === 'home' && repeatCount === 1 && addressRepeatCounts.size > 1) {
        score -= 18;
      }
      return score;
    },
    disqualify: (candidate) => {
      const address = sanitizeAddressValue(candidate.value);
      if (!address) return true;
      const key = normalizeAddressKey(address);
      const aligned = sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl) >= 28;
      if (candidate.intent === 'contact' || candidate.intent === 'about') return false;
      if (!aggregateRoot || aligned) return false;
      return !fallbackAddressKeys.has(key);
    },
  });
  const address = selectedAddressCandidate?.value || '';
  const selectedAddressSource = selectedAddressCandidate?.sourceUrl || '';
  const location = (selectedAddressSource
    ? pickBestCandidate(allGeoCandidates, (value) => `${value.latitude ?? ''}:${value.longitude ?? ''}`, {
        extraScore: (candidate) => {
          let score = sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl);
          if (normalizePageUrl(candidate.sourceUrl) === normalizePageUrl(selectedAddressSource)) {
            score += 40;
          }
          return score;
        },
        disqualify: (candidate) =>
          aggregateRoot &&
          sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl) < 28 &&
          normalizePageUrl(candidate.sourceUrl) !== normalizePageUrl(selectedAddressSource),
      })
    : pickBestCandidate(
        allGeoCandidates,
        (value) => `${value.latitude ?? ''}:${value.longitude ?? ''}`,
        {
          extraScore: (candidate) => sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl),
          disqualify: (candidate) =>
            aggregateRoot && sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl) < 28,
        }
      ))?.value || { latitude: null, longitude: null };
  const phone = pickBestCandidate(allPhoneCandidates, normalizePhoneKey, {
    extraScore: (candidate) => {
      let score = sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl);
      if (
        preferredContactPage &&
        normalizePageUrl(candidate.sourceUrl) === normalizePageUrl(preferredContactPage.finalUrl)
      ) {
        score += 30;
      }
      if (candidate.intent === 'contact') score += 12;
      if (aggregateRoot && (candidate.intent === 'location' || candidate.intent === 'program')) {
        score -= 20;
      }
      return score;
    },
    disqualify: (candidate) =>
      aggregateRoot &&
      sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl) < 28 &&
      (candidate.intent === 'location' || candidate.intent === 'program'),
  })?.value || '';
  const email = pickBestCandidate(allEmailCandidates, normalizeStringKey, {
    extraScore: (candidate) => {
      let score = sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl);
      if (
        preferredContactPage &&
        normalizePageUrl(candidate.sourceUrl) === normalizePageUrl(preferredContactPage.finalUrl)
      ) {
        score += 30;
      }
      if (candidate.intent === 'contact') score += 12;
      if (aggregateRoot && (candidate.intent === 'location' || candidate.intent === 'program')) {
        score -= 20;
      }
      return score;
    },
    disqualify: (candidate) =>
      aggregateRoot &&
      sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl) < 28 &&
      (candidate.intent === 'location' || candidate.intent === 'program'),
  })?.value || '';
  const pickedWebsiteCandidate =
    pickBestCandidate(allWebsiteCandidates, normalizePageUrl, {
      extraScore: (candidate) =>
        sourceRelationScore(candidate.value, normalizedFallbackUrl) +
        sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl),
    })?.value || '';
  const website = pickPreferredString(
    normalizedFallbackUrl,
    pickedWebsiteCandidate,
    (value) => websiteSelectionQuality(value, normalizedFallbackUrl)
  );
  const hours =
    pickBestCandidate(allHoursCandidates, normalizeHoursKey, {
      extraScore: (candidate) => {
        let score = sourceRelationScore(candidate.sourceUrl, normalizedFallbackUrl);
        if (
          preferredHoursPage &&
          normalizePageUrl(candidate.sourceUrl) === normalizePageUrl(preferredHoursPage.finalUrl)
        ) {
          score += 25;
        }
        if (candidate.intent === 'hours') score += 15;
        return score;
      },
    })?.value || {
      periods: [],
      weekdayText: [],
    };

  const mergedServiceTypes = new Set<string>();
  mergedServiceTypes.add(category);
  for (const candidate of allServiceTypeCandidates) {
    if (!candidate.value) continue;
    mergedServiceTypes.add(candidate.value);
  }

  return sanitizeSanityDoc({
    name: name || website || '',
    description: [
      {
        _type: 'block',
        children: [{ _type: 'span', text: descriptionText }],
        markDefs: [],
        style: 'normal',
      },
    ],
    address,
    location,
    serviceTypes: Array.from(mergedServiceTypes)
      .filter(Boolean)
      .map((_id) => ({ _id })),
    hoursOfOperation: {
      periods: hours.periods,
      weekdayText: hours.weekdayText,
    },
    contact: {
      phone,
      email,
      website,
    },
  }, category);
}

function shouldIncludeAllContent(intent: PageIntent): boolean {
  return intent === 'contact' || intent === 'location' || intent === 'about' || intent === 'faq';
}

function hasHoursData(doc: SanityDoc): boolean {
  const weekdayText = Array.isArray(doc.hoursOfOperation?.weekdayText)
    ? doc.hoursOfOperation.weekdayText.map((entry) => sanitizeScalarString(entry)).filter(Boolean)
    : [];
  const periods = Array.isArray(doc.hoursOfOperation?.periods) ? doc.hoursOfOperation.periods : [];
  return weekdayText.length > 0 || periods.length > 0;
}

export function isSanityDocIncomplete(doc: SanityDoc): boolean {
  return (
    addressQuality(doc.address) === 0 ||
    phoneQuality(doc.contact?.phone) < 2 ||
    emailQuality(doc.contact?.email) === 0 ||
    !hasHoursData(doc)
  );
}

function sanitizeHoursData(hours: SanityDoc['hoursOfOperation'] | undefined): SanityDoc['hoursOfOperation'] {
  const weekdayText = Array.isArray(hours?.weekdayText)
    ? dedupeStrings(hours.weekdayText.map((entry) => sanitizeScalarString(entry)).filter(Boolean))
    : [];
  const periods = Array.isArray(hours?.periods) ? hours.periods : [];
  return { periods, weekdayText };
}

function sanitizeServiceTypes(
  serviceTypes: SanityDoc['serviceTypes'] | undefined,
  category?: string
): SanityDoc['serviceTypes'] {
  const merged = new Map<string, { _id: string }>();
  for (const item of serviceTypes || []) {
    const id = sanitizeScalarString(item?._id);
    if (!id) continue;
    merged.set(id, { _id: id });
  }
  if (category) {
    const id = sanitizeScalarString(category);
    if (id) merged.set(id, { _id: id });
  }
  return Array.from(merged.values());
}

function sanitizeSanityDoc(doc: SanityDoc, category?: string): SanityDoc {
  const primaryDescription = sanitizeScalarString(doc.description?.[0]?.children?.[0]?.text);
  return {
    name: sanitizeScalarString(doc.name),
    description: [
      {
        _type: 'block',
        children: [{ _type: 'span', text: primaryDescription }],
        markDefs: [],
        style: 'normal',
      },
    ],
    address: sanitizeScalarString(doc.address),
    location: {
      latitude:
        typeof doc.location?.latitude === 'number' && Number.isFinite(doc.location.latitude)
          ? doc.location.latitude
          : null,
      longitude:
        typeof doc.location?.longitude === 'number' && Number.isFinite(doc.location.longitude)
          ? doc.location.longitude
          : null,
    },
    serviceTypes: sanitizeServiceTypes(doc.serviceTypes, category),
    hoursOfOperation: sanitizeHoursData(doc.hoursOfOperation),
    contact: {
      phone: sanitizePhoneValue(doc.contact?.phone),
      email: sanitizeEmailValue(doc.contact?.email),
      website: sanitizeWebsiteValue(doc.contact?.website),
    },
  };
}

function pickPreferredString(
  primary: string,
  enrichment: string,
  quality: (value: string) => number
): string {
  const primaryQuality = quality(primary);
  const enrichmentQuality = quality(enrichment);
  if (enrichmentQuality > primaryQuality) return enrichment;
  if (primaryQuality > 0) return primary;
  return enrichment || primary;
}

export function mergeSanityDocs(
  primary: SanityDoc,
  enrichment: SanityDoc,
  category?: string,
  targetUrl?: string
): SanityDoc {
  const primaryDoc = sanitizeSanityDoc(primary, category);
  const enrichmentDoc = sanitizeSanityDoc(enrichment, category);
  const normalizedTargetUrl = sanitizeWebsiteValue(targetUrl || primaryDoc.contact.website || enrichmentDoc.contact.website);
  const description =
    primaryDoc.description?.[0]?.children?.[0]?.text?.trim() ||
    !enrichmentDoc.description?.[0]?.children?.[0]?.text?.trim()
      ? primaryDoc.description
      : enrichmentDoc.description;

  const location =
    primaryDoc.location.latitude !== null || primaryDoc.location.longitude !== null
      ? primaryDoc.location
      : enrichmentDoc.location;

  const mergedServiceTypes = new Map<string, { _id: string }>();
  for (const item of [...primaryDoc.serviceTypes, ...enrichmentDoc.serviceTypes]) {
    if (!item?._id) continue;
    mergedServiceTypes.set(item._id, item);
  }

  const primaryWebsiteQuality = websiteSelectionQuality(
    primaryDoc.contact.website,
    normalizedTargetUrl || enrichmentDoc.contact.website
  );
  const enrichmentWebsiteQuality = websiteSelectionQuality(
    enrichmentDoc.contact.website,
    normalizedTargetUrl || primaryDoc.contact.website || enrichmentDoc.contact.website
  );
  const preferEnrichmentIdentity =
    enrichmentDoc.name &&
    enrichmentWebsiteQuality >= primaryWebsiteQuality + 20 &&
    primaryWebsiteQuality < 60;

  const selectedHours =
    hoursQuality(enrichmentDoc.hoursOfOperation) > hoursQuality(primaryDoc.hoursOfOperation)
      ? enrichmentDoc.hoursOfOperation
      : primaryDoc.hoursOfOperation;

  return {
    name: preferEnrichmentIdentity ? enrichmentDoc.name || primaryDoc.name : primaryDoc.name || enrichmentDoc.name,
    description,
    address: pickPreferredString(primaryDoc.address, enrichmentDoc.address, addressQuality),
    location,
    serviceTypes: Array.from(mergedServiceTypes.values()),
    hoursOfOperation: selectedHours,
    contact: {
      phone: pickPreferredString(primaryDoc.contact.phone, enrichmentDoc.contact.phone, phoneQuality),
      email: pickPreferredString(primaryDoc.contact.email, enrichmentDoc.contact.email, emailQuality),
      website: pickPreferredString(
        primaryDoc.contact.website,
        enrichmentDoc.contact.website,
        (value) =>
          websiteSelectionQuality(
            value,
            normalizedTargetUrl || enrichmentDoc.contact.website || primaryDoc.contact.website
          )
      ),
    },
  };
}

function buildRetrievalSummary(bundle: RetrievalBundle) {
  return {
    root: bundle.root,
    candidates: bundle.candidates,
    pages: bundle.pages.map((page) => ({
      url: page.finalUrl,
      intent: page.intent,
      provider: page.provider,
      fetchedAt: page.fetchedAt,
      title: page.title,
      description: page.description,
      textLength: page.text.length,
      linkCount: page.links.length,
      addressCandidates: page.addressCandidates.map((candidate) => candidate.value),
      phoneCandidates: page.phoneCandidates.map((candidate) => candidate.value),
      emailCandidates: page.emailCandidates.map((candidate) => candidate.value),
      hoursCandidateCount: page.hoursCandidates.length,
      serviceTypeCandidates: page.serviceTypeCandidates.map((candidate) => candidate.value),
    })),
  };
}

async function scrapePageForEvidence(url: string, intent: PageIntent): Promise<ScrapePayload> {
  const waitForNetworkIdleMs = parseIntEnv(process.env.SCRAPE_PAGE_INTENT_TIMEOUT_MS, 0);
  return scrapeWithProviders({
    url,
    includeAllContent: shouldIncludeAllContent(intent),
    waitForNetworkIdleMs: waitForNetworkIdleMs > 0 ? waitForNetworkIdleMs : undefined,
  });
}

export async function collectRetrievalBundle(
  url: string,
  category: string
): Promise<RetrievalBundle> {
  const root = await scrapePageForEvidence(url, 'home');
  const pages: PageEvidence[] = [collectPageEvidenceFromScrapedPage(root, 'home', category)];

  const enableMultiPage = parseBoolEnv(process.env.SCRAPE_ENABLE_MULTI_PAGE, true);
  const targetLimit = Math.max(
    0,
    parseIntEnv(process.env.SCRAPE_TARGET_PAGE_LIMIT, DEFAULT_TARGET_PAGE_LIMIT)
  );
  const baseUrl = firstNonEmpty([root.final_url, root.url, url]);
  const candidates =
    enableMultiPage && targetLimit > 0
      ? rankTargetPageLinks(root.data?.links || [], baseUrl, Math.max(HOURS_LINK_LIMIT, targetLimit))
      : [];

  for (const candidate of candidates) {
    const page = await scrapePageForEvidence(candidate.url, candidate.intent);
    pages.push(collectPageEvidenceFromScrapedPage(page, candidate.intent, category));
  }

  return {
    root,
    candidates,
    pages,
    sanityDoc: buildSanityDocFromEvidence(pages, category, url),
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

export async function runPipeline(options: PipelineOptions): Promise<PipelineRunResult> {
  const { city, state, category, perQuery, maxUrls, outputDir } = options;

  const perQueryValue = parseIntArg(perQuery, 3);
  const maxUrlsValue = parseIntArg(maxUrls, 10);
  const resolvedOutputDir = path.resolve(process.cwd(), outputDir ?? 'outputs');
  await mkdir(resolvedOutputDir, { recursive: true });

  const queries = await runQueryGenerator(city, state, category);
  const queryFile = saveQueriesToFile(city, category, queries, resolvedOutputDir);

  const searchResults = await runSearchAgent(queries, { perQuery: perQueryValue });

  const seen = new Set<string>();
  const orderedUrls: string[] = [];
  for (const result of searchResults) {
    for (const url of result.urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      orderedUrls.push(url);
    }
  }

  const urlsToScrape = orderedUrls.slice(0, maxUrlsValue);
  const scraped: Array<{ url: string; result: unknown }> = [];
  const sanityDocs: SanityDoc[] = [];
  const extracted: Array<{ url: string; result: SanityDoc; method: 'agent' | 'fallback' }> = [];

  for (const url of urlsToScrape) {
    const agentHistory = await runAgent({
      userMessage: `${SYSTEM_PROMPT}\nCategory: ${category}\nURL: ${url}`,
      tools,
      quiet: true,
    });

    const parsedAgentDoc = parseAgentOutput(agentHistory);
    const agentDoc = parsedAgentDoc ? sanitizeSanityDoc(parsedAgentDoc, category) : null;
    const shouldEnrichAgent = agentDoc ? isSanityDocIncomplete(agentDoc) : false;

    if (agentDoc && !shouldEnrichAgent) {
      sanityDocs.push(agentDoc);
      extracted.push({ url, result: agentDoc, method: 'agent' });
      continue;
    }

    if (!agentDoc) {
      console.warn(`Agent extraction failed for ${url}, using deterministic fallback.`);
    }

    const retrieval = await collectRetrievalBundle(url, category);
    scraped.push({ url, result: buildRetrievalSummary(retrieval) });

    const finalDoc = agentDoc
      ? mergeSanityDocs(agentDoc, retrieval.sanityDoc, category, url)
      : sanitizeSanityDoc(retrieval.sanityDoc, category);
    sanityDocs.push(finalDoc);
    extracted.push({ url, result: finalDoc, method: agentDoc ? 'agent' : 'fallback' });
  }

  const sanityFile = path.join(
    resolvedOutputDir,
    `${safeName(city)}_${safeName(category)}_sanity.json`
  );
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

  const outputFile = path.join(
    resolvedOutputDir,
    `${safeName(city)}_${safeName(category)}_pipeline.json`
  );
  await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf-8');

  return { output, outputFile, sanityFile };
}
