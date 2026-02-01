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

const systemPrompt = `
You are a query generator for a web-search pipeline that finds local help resources.

Input: city, state, and category (like "FOOD_BANK", "SHELTER", "DRUG_ASSISTANCE", "ABUSE_SUPPORT").

Output: exactly 10 search queries, each on its own line, no numbering, no extra text.

Constraints and style:
- Queries should be realistic things a person would type into a search engine to find local providers.
- Prefer .org, .gov, and .edu domains using site: filters when helpful.
- Use both the city and state in most queries.
- Use a mix of phrasing and related synonyms for the category.
- Do NOT explain what you are doing. Do NOT add headings or commentary.
- Output MUST be plain text with 10 lines, one query per line.
`.trim();

// Few-shot example to steer format and tone
const fewShotUser = `
city: Salem
state: OR
category: FOOD_BANK
`.trim();

const fewShotAssistant = `
Salem OR food bank site:.org OR site:.gov
food pantry "Salem, Oregon"
free food boxes Salem OR
emergency food assistance Marion County Oregon
church food pantry Salem OR
mobile food bank "Salem OR"
community meal program "Salem Oregon"
SNAP food resources Salem OR
free groceries for families Salem OR
low income food assistance Marion County OR
`.trim();

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
function normalizeQueries(raw: string): string[] {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Strip bullets / numbering if the model sneaks them in
  const cleaned = lines.map((line) => {
    const m = line.match(/^[-*•]\s*(.+)$/); // bullet
    if (m) return m[1].trim();

    const n = line.match(/^\d+\.\s*(.+)$/); // numbered list
    if (n) return n[1].trim();

    return line;
  });

  const unique: string[] = [];
  for (const q of cleaned) {
    if (!unique.includes(q)) unique.push(q);
    if (unique.length === 10) break;
  }

  // If we got fewer than 10 unique queries, pad by reusing from the top.
  // Duplicates here are acceptable; the Search Agent can de-dup downstream.
  if (unique.length > 0 && unique.length < 10) {
    let i = 0;
    while (unique.length < 10) {
      unique.push(unique[i % unique.length]);
      i += 1;
    }
  }

  return unique.slice(0, 10);
}

/**
 * Core function: generate exactly 10 search queries for (city, state, category).
 */
async function runQueryGenerator(city: string, state: string, category: string): Promise<string[]> {
  const messages = buildMessages(city, state, category);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned an empty response for query generation.');
  }

  return normalizeQueries(content);
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
