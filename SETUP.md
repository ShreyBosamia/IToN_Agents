# Developer Setup & CLI Reference

> Looking for a project overview? See the [README](README.md).

This document covers environment setup, CLI usage, API endpoints, and development commands for contributors and integrators.

---

## Prerequisites

- Node.js 18+ (tested on Node 20)
- An OpenAI API key
- A Brave Search API key (required for search/pipeline stages)
- A Firecrawl API key (required for the default scraper path)

---

## Setup

1. Install dependencies

   ```bash
   npm install
   ```

2. Configure environment

   Create a `.env` file in the project root with:

   ```env
   OPENAI_API_KEY=your_openai_api_key
   BRAVE_SEARCH_API_KEY=your_brave_search_api_key
   FIRECRAWL_API_KEY=your_firecrawl_api_key
   SCRAPER_PROVIDER=auto
   FIRECRAWL_TIMEOUT_MS=30000
   FIRECRAWL_MAX_AGE_MS=0
   ```

   Note: the env variable name is `OPENAI_API_KEY` (no extra underscore).
   `SCRAPER_PROVIDER=auto` is the recommended default: Firecrawl first, Playwright fallback.

3. (Optional) Target website for the original HTML-analysis agent

   The default target URL is set in `src/systemPrompt.ts`. Update the `<context>...</context>` URL if you want the main agent to analyze a different site.

---

## Usage

### 1. Single-site extraction agent

You can pass a prompt directly via npm scripts. Use `--` so arguments pass through to the script.

```bash
npm start -- "Summarize the content of the provided website."
```

Equivalents:

```bash
npm run start -- "Find the clinic hours and phone numbers."
npx tsx index.ts "Extract address and contacts from the page."
```

This flow:

- Sends your prompt plus a system instruction to OpenAI (`gpt-4o-mini`).
- Lets the model auto-invoke the `scrape_website` tool, which now uses **Firecrawl first** and falls back to **Playwright** when needed.
- Returns **raw JSON** describing the organization/resource when possible (see `src/systemPrompt.ts`).

### 2. Query Generator agent

The **Query Generator** is the first step of the In Time of Need pipeline. Given a **city**, **state**, and **category** (e.g., `FOOD_BANK`, `SHELTER`, `DRUG_ASSISTANCE`, `ABUSE_SUPPORT`), it:

- Calls OpenAI with a carefully designed system prompt and few-shot example.
- Instructs the model to return **valid JSON only**: a JSON array of **exactly 10 distinct** query strings.
- Parses and validates the response (JSON → `string[]`) to guarantee exactly 10 unique queries.
- If the model output fails validation (wrong count, duplicates, invalid JSON), it performs a **single repair retry** with stricter instructions.
- Uses realistic phrases a person would type into a search engine.
- Prefers `.org`, `.gov`, and `.edu` domains via `site:` filters where helpful.
- Writes the queries to a plain `.txt` file (10 lines, one query per line) that subsequent agents (Search Agent, etc.) can consume.

#### CLI usage

From the repo root:

```bash
npm run query -- "<CITY>" "<STATE_ABBREV>" "<CATEGORY>"
```

Examples:

```bash
npm run query -- "Salem" "OR" "FOOD_BANK"
npm run query -- "Portland" "OR" "SHELTER"
npm run query -- "Eugene" "OR" "ABUSE_SUPPORT"
```

Note: categories are treated as an input string. For best consistency (and to match category-specific prompt hints), use **UPPER_SNAKE_CASE** categories like `FOOD_BANK` and `SHELTER`.

This will:

1. Print the 10 generated queries to stdout.
2. Create a file in `examples/` named:

   ```text
   <CityWithUnderscores>_<CATEGORY>_queries.txt
   ```

   For example:
   - Input: `Salem OR FOOD_BANK`
   - Output file: `examples/Salem_FOOD_BANK_queries.txt`

#### Query text file format

Each query file is **plain UTF-8 text** with:

- Exactly **10 lines**
- One query per line
- No numbering, no headers, no JSON, no extra commentary

This is intentionally different from the model response format (JSON array). The JSON contract is used only to make generation/parsing reliable; the saved `.txt` remains line-delimited for simplicity.

Example (`Salem_FOOD_BANK_queries.txt`):

```text
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
```

Downstream agents (the Search Agent) can read this file line-by-line and treat each line as an independent search query.

### 3. Deterministic pipeline demo (query → search → scrape)

This pipeline connects the Query Generator, a Brave Search-based Search Agent, and the scraper tool into a deterministic, step-by-step flow.

```bash
npm run pipeline -- "<CITY>" "<STATE_ABBREV>" "<CATEGORY>" [perQuery] [maxUrls]
```

Preferred shortcuts:

```bash
npm run pipeline:auto -- "<CITY>" "<STATE_ABBREV>" "<CATEGORY>" [perQuery] [maxUrls]
npm run pipeline:firecrawl -- "<CITY>" "<STATE_ABBREV>" "<CATEGORY>" [perQuery] [maxUrls]
npm run pipeline:playwright -- "<CITY>" "<STATE_ABBREV>" "<CATEGORY>" [perQuery] [maxUrls]
```

Example:

```bash
npm run pipeline -- "Salem" "OR" "FOOD_BANK" 3 10
```

This will:

1. Generate 10 queries and save them under `outputs/` as `<City>_<CATEGORY>_queries.txt`
2. Search each query via Brave and collect the top N URLs per query
3. Scrape the first `maxUrls` unique URLs
4. Write the full pipeline output under `outputs/` to:

```text
<City>_<CATEGORY>_pipeline.json
```

The scrape payload now also includes:

- `provider`
- `provider_attempts`
- `raw_provider_metadata`

### 4. Firecrawl crawl/map experiment

To evaluate Firecrawl site discovery on a directory page without changing the production crawler:

```bash
npm run firecrawl:experiment -- "https://www.feedingillinois.org/food-banks"
```

This prints a JSON summary of Firecrawl `map` and `crawl` results.

### 5. HTTP pipeline server (review + approval workflow)

If you want to run the pipeline on a server and fetch the output over HTTP (e.g., to power a staff review UI), you can run the built-in HTTP server:

```bash
npm run server
```

By default it listens on `PORT=3000`. The server exposes a minimal job-based API:

- `POST /jobs` — start a pipeline run
- `GET /jobs/:id` — fetch job status/output
- `POST /jobs/:id/approve` — mark output approved
- `POST /jobs/:id/deny` — mark output denied
- `GET /health` — health check

The server sends CORS headers for browser-based clients. By default `CORS_ORIGIN=*`, which is convenient for local development. For a deployed Sanity Studio, restrict it to the exact Studio origin:

```bash
CORS_ORIGIN=https://your-studio.sanity.studio npm run server
```

Use a comma-separated list if you need both local and hosted Studio origins.

Example request:

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "city": "Salem",
    "state": "OR",
    "category": "FOOD_BANK",
    "perQuery": 3,
    "maxUrls": 10
  }'
```

The response includes a job `id`, which you can poll:

```bash
curl http://localhost:3000/jobs/<JOB_ID>
```

When the status becomes `ready_for_review`, the `output` field contains the pipeline output (including the `sanity` array). Staff can then approve or deny:

```bash
curl -X POST http://localhost:3000/jobs/<JOB_ID>/approve \
  -H "Content-Type: application/json" \
  -d '{"reviewer": "staff@example.com"}'
```

---

## Key files

- `index.ts` – CLI entrypoint for the original HTML-analysis agent.
- `src/agent.ts` – conversation loop, tool execution.
- `src/llm.ts` – OpenAI call setup (model, tools).
- `src/tools/index.ts` – tool registry.
- `src/tools/scrapeWebsite.ts` – `scrape_website` provider routing, normalization, and Firecrawl/Playwright implementations.
- `src/systemPrompt.ts` – system instructions and target URL.
- `src/memory.ts` – lightweight message storage (`db.json`).
- `src/agents/queryGenerator.ts` – Query Generator functions.
- `scripts/queryGeneratorCli.ts` – CLI wrapper for the Query Generator.
- `src/agents/searchAgent.ts` – Search Agent functions (Brave Search API).
- `scripts/pipeline.ts` – Deterministic pipeline demo (query → search → scrape).
- `scripts/firecrawlDirectoryExperiment.ts` – Firecrawl `map`/`crawl` experiment for directory evaluation.

---

## Customization

### Models and temperature

- The default model is `gpt-4o-mini` as defined in `src/llm.ts` and `src/agents/queryGenerator.ts`.
- Temperature is kept low (`0.1–0.2`) for predictable, parseable responses.

### Query Generator prompt / categories

- Behavior is controlled by a system prompt and few-shot example inside `src/agents/queryGenerator.ts`.
- To add new categories (e.g., `MENTAL_HEALTH`, `DISABILITY_SERVICES`), update the prompt description.
- Keep the strict output requirements (exactly 10 distinct queries) to keep downstream parsing simple.

### Tools & pipeline extension

- Add more tools in `src/tools` and register them in `src/tools/index.ts`.
- The Query Generator is designed to be the first step in a larger pipeline: Search → URL Classification → Scraping → Extraction → Normalization → API Update.

---

## Development & quality

```bash
npm run ci          # lint + format check + tests (full CI equivalent)
npm run lint        # ESLint
npm run lint:fix    # Auto-fix lint issues
npm run format      # Prettier
npm run format:check
npm test            # Vitest
npm run test:watch  # Watch mode
npm run coverage    # Coverage report
```

### CI

GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR: install → lint → format check → tests with coverage artifact.
