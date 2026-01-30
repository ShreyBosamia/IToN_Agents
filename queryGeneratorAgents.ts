import fs from 'node:fs';
import path from 'node:path';

import { openai } from './src/ai';

/**
 * Query Generator Agent
 *
 * This module uses OpenAI's Chat Completions API to produce exactly ten
 * Google-style search queries tailored to a given city, state, and
 * resource category. It follows the system prompt and few-shot example
 * from the project docs so that the model returns a predictable,
 * parseable list of queries.
 *
 * You can:
 *   - import `runQueryGenerator` from this file inside other agents, or
 *   - run it directly from the CLI (see bottom of file).
 */

const systemPromptBase = `
You are a query generator for a web-search pipeline that finds local help resources.

Input: city, state, and category (like "FOOD_BANK", "SHELTER", "DRUG_ASSISTANCE", "ABUSE_SUPPORT").

Output: a JSON array of exactly 10 distinct search queries (strings).

Hard requirements:
- Output MUST be valid JSON only (no markdown fences, no prose, no code block markers).
- The JSON MUST be an array of exactly 10 strings.
- Do NOT number the queries.
- Do NOT include duplicates.

Constraints and style:
- Queries should be realistic things a person would type into a search engine to find local providers.
- Prefer .org, .gov, and .edu domains using site: filters when helpful.
- Use both the city and state in most queries.
- Use a mix of phrasing and related synonyms for the category.
`.trim();

const CATEGORY_HINTS: Record<string, string[]> = {
  FOOD_BANK: [
    'food pantry',
    'free groceries',
    'mobile pantry',
    'SNAP',
    'WIC',
    'emergency food',
    'community meals',
  ],
  SHELTER: [
    'emergency shelter',
    'warming center',
    'transitional housing',
    'domestic violence shelter',
    'family shelter',
    'youth shelter',
  ],
};

function buildSystemPrompt(category: string): string {
  const hints = CATEGORY_HINTS[category]?.length
    ? CATEGORY_HINTS[category]
    : ['use relevant local terms and synonyms for the category'];

  return [
    systemPromptBase,
    '',
    `Category-specific guidance for ${category}:`,
    ...hints.map((h) => `- ${h}`),
  ].join('\n');
}

// Few-shot example to steer format and tone
const fewShotUser = `
city: Salem
state: OR
category: FOOD_BANK
`.trim();

const fewShotAssistant = `[
  "Salem OR food bank site:.org OR site:.gov",
  "food pantry \"Salem, Oregon\"",
  "free food boxes Salem OR",
  "emergency food assistance Marion County Oregon",
  "church food pantry Salem OR",
  "mobile food bank \"Salem OR\"",
  "community meal program \"Salem Oregon\"",
  "SNAP food resources Salem OR",
  "free groceries for families Salem OR",
  "low income food assistance Marion County OR"
]`;

/**
 * Build the messages array for OpenAI:
 * - system: global instructions
 * - user/assistant: few-shot example
 * - final user: real city/state/category
 */
function buildMessages(city: string, state: string, category: string) {
  const realUser = `
city: ${city}
state: ${state}
category: ${category}
  `.trim();

  return [
    { role: 'user' as const, content: fewShotUser },
    { role: 'assistant' as const, content: fewShotAssistant },
    { role: 'user' as const, content: realUser },
  ];
}

/**
 * Normalize and clamp the model output to exactly 10 queries.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function sanitizeQuery(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';

  const bullet = trimmed.match(/^[-*•]\s*(.+)$/);
  if (bullet) return bullet[1].trim();

  const numberedDot = trimmed.match(/^\d+\.\s*(.+)$/);
  if (numberedDot) return numberedDot[1].trim();

  const numberedParen = trimmed.match(/^\d+\)\s*(.+)$/);
  if (numberedParen) return numberedParen[1].trim();

  return trimmed;
}

function parseQueriesFromModelOutput(raw: string): string[] {
  const stripped = stripCodeFences(raw);

  // Preferred: strict JSON array of strings
  try {
    const parsed: unknown = JSON.parse(stripped);
    if (Array.isArray(parsed)) {
      const asStrings = parsed
        .filter((q) => typeof q === 'string')
        .map((q) => sanitizeQuery(q))
        .filter((q) => q.length > 0);

      return asStrings;
    }
  } catch {
    // Fall back to line parsing
  }

  // Fallback: newline-delimited queries
  return stripped
    .split('\n')
    .map((line) => sanitizeQuery(line))
    .filter((q) => q.length > 0);
}

function validateAndNormalizeQueries(queries: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const cleaned = q.trim();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    unique.push(cleaned);
  }

  if (unique.length !== 10) {
    throw new Error(`Expected exactly 10 distinct queries, got ${unique.length}.`);
  }

  return unique;
}

/**
 * Core function: generate exactly 10 search queries for (city, state, category).
 */
async function runQueryGenerator(city: string, state: string, category: string): Promise<string[]> {
  const messages = buildMessages(city, state, category);

  const systemPrompt = buildSystemPrompt(category);

  async function attemptGenerate(extraUserMessage?: string): Promise<string[]> {
    const attemptMessages = extraUserMessage
      ? [...messages, { role: 'user' as const, content: extraUserMessage }]
      : messages;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'system', content: systemPrompt }, ...attemptMessages],
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned an empty response for query generation.');
    }

    const parsed = parseQueriesFromModelOutput(content);
    return validateAndNormalizeQueries(parsed);
  }

  try {
    return await attemptGenerate();
  } catch (err) {
    // One cheap repair retry beats silently padding duplicates.
    const repairInstruction = `Your previous response did not meet the requirements.
Return ONLY a valid JSON array of exactly 10 DISTINCT strings.
No markdown fences. No extra text.
Use city/state/category exactly as provided.`;

    try {
      return await attemptGenerate(repairInstruction);
    } catch (err2) {
      const original = err instanceof Error ? err.message : String(err);
      const repaired = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(
        `Query generation failed validation after repair attempt. First error: ${original}. Repair error: ${repaired}.`
      );
    }
  }
}

/**
 * Write queries to a text file named "<city>_<category>_queries.txt".
 */
function saveQueriesToFile(city: string, category: string, queries: string[], outputDir?: string) {
  const safeCity = city.replace(/\s+/g, '_');
  const safeCategory = category.replace(/\s+/g, '_');
  const filename = `${safeCity}_${safeCategory}_queries.txt`;

  if (outputDir) {
    const resolvedDir = path.resolve(outputDir);
    fs.mkdirSync(resolvedDir, { recursive: true });
    const filepath = path.join(resolvedDir, filename);
    fs.writeFileSync(filepath, queries.join('\n'), 'utf-8');
    return filepath;
  }

  fs.writeFileSync(filename, queries.join('\n'), 'utf-8');
  return filename;
}

export { runQueryGenerator, saveQueriesToFile };
