import { readFile } from 'node:fs/promises';

const WEBSITE_PATH = 'websites.txt';
const PASS_SCORE = 50;
const MAX_URLS = 5;

// weights sum to 100
const WEIGHTS = {
  governmentSources: 20,
  clearContactInfo: 20,
  evidenceOfService: 20,
  freshnessSignal: 15,
  nonDirectorySite: 15,
  duplicateDetection: 10,
} as const;

type ScoreBreakdown = {
  governmentSources: number;
  clearContactInfo: number;
  evidenceOfService: number;
  freshnessSignal: number;
  nonDirectorySite: number;
  duplicateDetection: number;
};

type Result = {
  url: string;
  score: number;
  pass: boolean;
  breakdown: ScoreBreakdown;
  notes: string[];
};

function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.startsWith('#')) return null;

  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, timeoutMs = 12000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (ProviderQualityScorer/Basic)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;

    const html = await res.text();
    return html && html.length > 100 ? html : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 1) Government sources
 * Basic: if page has .gov links or words like "licensed" / "department".
 */
function checkGovernmentSources(html: string, text: string): { points: number; note: string } {
  const t = text.toLowerCase();

  const hasGovLink =
    /\bhttps?:\/\/[^\s"'<>]+\.gov\b/i.test(html) || /\b\.state\.[a-z]{2}\.us\b/i.test(html);
  const govWords = [
    'government',
    'department',
    'ministry',
    'licensed',
    'licensing',
    'public health',
  ];
  const wordHit = govWords.some((w) => t.includes(w));

  if (hasGovLink)
    return { points: WEIGHTS.governmentSources, note: 'Found .gov (or similar) link.' };
  if (wordHit)
    return {
      points: Math.round(WEIGHTS.governmentSources * 0.5),
      note: 'Found government/licensing wording.',
    };
  return { points: 0, note: 'No government source signals.' };
}

/**
 * 2) Clear contact info
 * Basic: email OR phone OR a “contact” page link/word.
 */
function checkClearContactInfo(html: string, text: string): { points: number; note: string } {
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const phone = /(\+?\d{1,2}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/.test(text);
  const contactWord = /\bcontact\b/i.test(text);
  const contactLink = /href\s*=\s*["'][^"']*contact[^"']*["']/i.test(html);

  const signals = [email, phone, contactWord || contactLink].filter(Boolean).length;

  if (signals >= 2)
    return {
      points: WEIGHTS.clearContactInfo,
      note: 'Strong contact info (email/phone/contact page).',
    };
  if (signals === 1)
    return { points: Math.round(WEIGHTS.clearContactInfo * 0.6), note: 'Some contact info found.' };
  return { points: 0, note: 'No clear contact info found.' };
}

/**
 * 3) Evidence of service
 * Basic: service-related words exist.
 */
function checkEvidenceOfService(text: string): { points: number; note: string } {
  const t = text.toLowerCase();
  const phrases = [
    'our services',
    'services',
    'we provide',
    'what we do',
    'appointment',
    'schedule',
    'treatment',
    'care',
    'support',
    'pricing',
    'insurance',
  ];

  const hits = phrases.filter((p) => t.includes(p)).length;

  if (hits >= 3)
    return {
      points: WEIGHTS.evidenceOfService,
      note: 'Evidence of services found (multiple signals).',
    };
  if (hits >= 1)
    return {
      points: Math.round(WEIGHTS.evidenceOfService * 0.5),
      note: 'Some service wording found.',
    };
  return { points: 0, note: 'No obvious evidence of services.' };
}

/**
 * 4) Freshness signal
 * Basic: "updated", "posted", "published" or a date-looking string.
 */
function checkFreshnessSignal(text: string): { points: number; note: string } {
  const t = text.toLowerCase();

  const freshnessWords = [
    'last updated',
    'updated on',
    'updated:',
    'posted on',
    'published on',
    'recent posts',
    'blog',
  ];
  const hasWord = freshnessWords.some((w) => t.includes(w));

  // very basic date patterns
  const hasIsoDate = /\b20\d{2}-\d{2}-\d{2}\b/.test(text);
  const hasMonthDate =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s+20\d{2}\b/i.test(
      text
    );

  if (hasWord && (hasIsoDate || hasMonthDate)) {
    return {
      points: WEIGHTS.freshnessSignal,
      note: 'Freshness signals (updated words + date found).',
    };
  }
  if (hasWord || hasIsoDate || hasMonthDate) {
    return {
      points: Math.round(WEIGHTS.freshnessSignal * 0.6),
      note: 'Some freshness signal found.',
    };
  }
  return { points: 0, note: 'No freshness signal found.' };
}

/**
 * 5) Non-directory site
 * Basic: penalize if it looks like a directory/listing.
 */
function checkNonDirectorySite(text: string): { points: number; note: string } {
  const t = text.toLowerCase();

  const directorySignals = [
    'directory',
    'listings',
    'browse providers',
    'find a provider',
    'search providers',
    'compare providers',
    'top rated',
    'near you',
  ];

  const hit = directorySignals.some((w) => t.includes(w));
  if (hit) return { points: 0, note: 'Looks like a directory/listing site (penalized).' };
  return { points: WEIGHTS.nonDirectorySite, note: 'Does not look like a directory site.' };
}

function checkDuplicateDetection(
  normalizedText: string,
  seenTexts: Set<string>
): { points: number; note: string } {
  if (seenTexts.has(normalizedText)) {
    return { points: 0, note: 'Duplicate content detected (exact match to earlier site).' };
  }
  seenTexts.add(normalizedText);
  return { points: WEIGHTS.duplicateDetection, note: 'Not a detected duplicate.' };
}

async function readUrls(path: string): Promise<string[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .map(normalizeUrl)
    .filter((u): u is string => Boolean(u));
}

async function scoreSite(url: string, seenTexts: Set<string>): Promise<Result> {
  const html = await fetchHtml(url);

  const breakdown: ScoreBreakdown = {
    governmentSources: 0,
    clearContactInfo: 0,
    evidenceOfService: 0,
    freshnessSignal: 0,
    nonDirectorySite: 0,
    duplicateDetection: 0,
  };

  const notes: string[] = [];

  if (!html) {
    return {
      url,
      score: 0,
      pass: false,
      breakdown,
      notes: ['Fetch failed or not HTML.'],
    };
  }

  const text = htmlToText(html);
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

  const gov = checkGovernmentSources(html, text);
  breakdown.governmentSources = gov.points;
  notes.push(gov.note);

  const contact = checkClearContactInfo(html, text);
  breakdown.clearContactInfo = contact.points;
  notes.push(contact.note);

  const service = checkEvidenceOfService(text);
  breakdown.evidenceOfService = service.points;
  notes.push(service.note);

  const fresh = checkFreshnessSignal(text);
  breakdown.freshnessSignal = fresh.points;
  notes.push(fresh.note);

  const nonDir = checkNonDirectorySite(text);
  breakdown.nonDirectorySite = nonDir.points;
  notes.push(nonDir.note);

  const dup = checkDuplicateDetection(normalized, seenTexts);
  breakdown.duplicateDetection = dup.points;
  notes.push(dup.note);

  const score =
    breakdown.governmentSources +
    breakdown.clearContactInfo +
    breakdown.evidenceOfService +
    breakdown.freshnessSignal +
    breakdown.nonDirectorySite +
    breakdown.duplicateDetection;

  return {
    url,
    score,
    pass: score >= PASS_SCORE,
    breakdown,
    notes,
  };
}

async function main() {
  const urls = (await readUrls(WEBSITE_PATH)).slice(0, MAX_URLS);
  if (urls.length === 0) {
    console.error(`No valid URLs in ${WEBSITE_PATH}`);
    process.exit(1);
  }

  const seenTexts = new Set<string>();
  const results: Result[] = [];

  for (const url of urls) {
    console.log(`Scoring ${url} ...`);
    results.push(await scoreSite(url, seenTexts));
  }

  console.log('\nResults');
  console.log('='.repeat(60));

  for (const r of results) {
    console.log(`\n${r.url}`);
    console.log(`Score: ${r.score}/100  Pass: ${r.pass ? 'YES' : 'NO'}`);
    console.log('Breakdown:', r.breakdown);
    console.log('Notes:');
    for (const n of r.notes) console.log(`  - ${n}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nPassed: ${passed}/${results.length} (pass >= ${PASS_SCORE})`);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
