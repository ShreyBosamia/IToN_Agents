# AI Agent Overview

A minimal TypeScript agent system that calls OpenAI’s Chat Completions API with tool calling.

Originally, this project focused on analyzing a single target webpage. It now also includes a **Query Generator agent** that produces search queries as the first step of a broader “In Time of Need” data pipeline (query generation → web search → URL classification → scraping → information extraction → normalization → API update).

---

## Prerequisites

- Node.js 18+ (tested on Node 20)
- An OpenAI API key

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
   ```

   Note: the env variable name is `OPENAI_API_KEY` (no extra underscore).
   The Brave Search key is required for the search stage of the pipeline.

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
- Lets the model auto-invoke the `scrape_website` tool (Playwright) to retrieve trimmed page content and metadata.
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

Downstream agents (the Search Agent) can read this file line-by-line and treat each line as an independent search query. This matches the example queries shown in the project’s AI pipeline diagram.

### 3. Deterministic pipeline demo (query → search → scrape)

This pipeline connects the Query Generator, a Brave Search-based Search Agent, and the scraper tool into a deterministic, step-by-step flow.

```bash
npm run pipeline -- "<CITY>" "<STATE_ABBREV>" "<CATEGORY>" [perQuery] [maxUrls]
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

### 4. HTTP pipeline server (review + approval workflow)

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

## What it does

### Original HTML analysis agent

- Sends your prompt plus a system instruction to OpenAI (`gpt-4o-mini`).
- When needed, the model auto-invokes the `scrape_website` tool to retrieve trimmed page content, links, and metadata.
- The tool returns structured scrape output (truncated for safety), which is fed back to the model.
- The model returns structured JSON according to the system prompt.

### Query Generator agent

- Uses a system prompt that defines its role: _“query generator for a web-search pipeline that finds local help resources.”_
- Takes structured input (city, state, category) and produces a **fixed, predictable format**:
  - Model response: JSON array of 10 strings
  - Saved file: 10 queries, one per line
- Uses a few-shot example (`Salem`, `OR`, `FOOD_BANK`) to enforce style and format.
- Prefers `.org`, `.gov`, `.edu` domains where useful via `site:` filters.
- Outputs to a `.txt` file for the next pipeline stage (Search Agent) rather than directly hitting a search API.

---

## Key files

- `index.ts` – CLI entrypoint for the original HTML-analysis agent.
- `src/agent.ts` – conversation loop, tool execution.
- `src/llm.ts` – OpenAI call setup (model, tools).
- `src/tools/index.ts` – `scrape_website` tool implementation.
- `src/systemPrompt.ts` – system instructions and target URL.
- `src/memory.ts` – lightweight message storage (`db.json`).
- `src/agents/queryGenerator.ts` – Query Generator functions:
  - `runQueryGenerator(city, state, category)` → returns 10 queries as a `string[]`
  - `saveQueriesToFile(city, category, queries)` → writes the `.txt` file described above.

- `scripts/queryGeneratorCli.ts` – CLI wrapper for the Query Generator, used by `npm run query`.
- `src/agents/searchAgent.ts` – Search Agent functions (Brave Search API).
- `scripts/pipeline.ts` – Deterministic pipeline demo (query → search → scrape).

---

## Customization

### Models and temperature

- The default model is `gpt-4o-mini` as defined in `src/llm.ts` and used similarly in the Query Generator.
- You can change the model in `src/llm.ts` and in `src/agents/queryGenerator.ts` if you want a different OpenAI model (ensure it supports Chat Completions and tools).
- Temperature is kept low (`0.1–0.2`) for predictable, parseable responses.

### Query Generator prompt / categories

- The Query Generator’s behavior is controlled by a system prompt and a few-shot example inside `src/agents/queryGenerator.ts`.
- To tune behavior:
  - Add new categories (e.g., `MENTAL_HEALTH`, `DISABILITY_SERVICES`) and update the prompt description.
  - Adjust the example to emphasize new phrasing or additional `site:` filters.
  - Keep the strict output requirements (exactly 10 distinct queries) to keep downstream parsing simple.

### Tools & pipeline extension

- You can add more tools in `src/tools` and register them in `src/tools/index.ts`.
- The Query Generator is designed to be the first step in a larger AI agent pipeline that includes:
  - Search Agent (web search)
  - URL Classifier (provider vs. directory vs. irrelevant)
  - Scraper Agent (HTML fetching + section extraction)
  - Information Extraction, Normalizer, and API Updater agents

---

## Development & quality

Common tasks:

- Run all tests:

  ```bash
  npm run ci
  ```

- Lint (ESLint):

  ```bash
  npm run lint
  ```

- Auto-fix lint issues where possible:

  ```bash
  npm run lint:fix
  ```

- Format (Prettier):

  ```bash
  npm run format
  ```

- Check formatting only:

  ```bash
  npm run format:check
  ```

- Run tests (Vitest):

  ```bash
  npm test
  ```

- Watch tests during development:

  ```bash
  npm run test:watch
  ```

- Coverage report:

  ```bash
  npm run coverage
  ```

### CI

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on push/PR and does the following:

- Install dependencies
- Lint
- Prettier check
- Tests (with coverage uploaded as an artifact) for batch runs.
