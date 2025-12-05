# AI Agent Overview

A minimal TypeScript agent system that calls OpenAI’s Chat Completions API with tool calling.

Originally, this project focused on fetching and analyzing the HTML of a single target webpage, then summarizing or extracting details from it. It now also includes a **Query Generator agent** that produces search queries as the first step of a broader “In Time of Need” data pipeline (query generation → web search → URL classification → scraping → information extraction → normalization → API update). :contentReference[oaicite:2]{index=2} :contentReference[oaicite:3]{index=3}

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
   ```

   Note: the env variable name is `OPENAI_API_KEY` (no extra underscore).

3. (Optional) Target website for the original HTML-analysis agent

   The default target URL is set in `src/systemPrompt.ts`. Update the `<context>...</context>` URL if you want the main agent to analyze a different site.

---

## Usage

### 1. Original single-site analysis agent

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
- Lets the model auto-invoke the `fetch_html_content` tool to retrieve the page’s HTML when needed.
- Feeds the raw HTML back into the model so it can reason over the content and respond with the requested summary/details.

### 2. Query Generator agent (new)

The **Query Generator** is the first step of the In Time of Need pipeline. Given a **city**, **state**, and **category** (e.g., `FOOD_BANK`, `SHELTER`, `DRUG_ASSISTANCE`, `ABUSE_SUPPORT`), it:

- Calls OpenAI with a carefully designed system prompt and few-shot example.
- Produces **exactly 10 search queries**, each on its own line.
- Uses realistic phrases a person would type into a search engine.
- Prefers `.org`, `.gov`, and `.edu` domains via `site:` filters where helpful.
- Writes the queries to a `.txt` file that subsequent agents (Search Agent, etc.) can consume.

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

This will:

1. Print the 10 generated queries to stdout.
2. Create a file named:

   ```text
   <CityWithUnderscores>_<CATEGORY>_queries.txt
   ```

   For example:
   - Input: `Salem OR FOOD_BANK`
   - Output file: `Salem_FOOD_BANK_queries.txt`

#### Query text file format

Each query file is **plain UTF-8 text** with:

- Exactly **10 lines**
- One query per line
- No numbering, no headers, no JSON, no extra commentary

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

---

## What it does

### Original HTML analysis agent

- Sends your prompt plus a system instruction to OpenAI (`gpt-4o-mini`).
- When needed, the model auto-invokes the `fetch_html_content` tool to retrieve a target page’s HTML.
- The tool returns the raw HTML (truncated for safety), which is fed back to the model.
- The model reasons over the content and responds with the requested summary/details.

### Query Generator agent

- Uses a system prompt that defines its role: _“query generator for a web-search pipeline that finds local help resources.”_
- Takes structured input (city, state, category) and produces a **fixed, predictable format**: 10 queries, one per line.
- Uses a few-shot example (`Salem`, `OR`, `FOOD_BANK`) to enforce style and format.
- Prefers `.org`, `.gov`, `.edu` domains where useful via `site:` filters.
- Outputs to a `.txt` file for the next pipeline stage (Search Agent) rather than directly hitting a search API.

---

## Key files

- `index.ts` – CLI entrypoint for the original HTML-analysis agent.
- `src/agent.ts` – conversation loop, tool execution.
- `src/llm.ts` – OpenAI call setup (model, tools).
- `src/tools/index.ts` – `fetch_html_content` tool implementation.
- `src/systemPrompt.ts` – system instructions and target URL.
- `src/memory.ts` – lightweight message storage (`db.json`).
- `queryGeneratorAgents.ts` – Query Generator functions:
  - `runQueryGenerator(city, state, category)` → returns 10 queries as a `string[]`
  - `saveQueriesToFile(city, category, queries)` → writes the `.txt` file described above.

- `scripts/queryGeneratorCli.ts` – CLI wrapper for the Query Generator, used by `npm run query`.

---

## Customization

### Models and temperature

- The default model is `gpt-4o-mini` as defined in `src/llm.ts` and used similarly in the Query Generator.
- You can change the model in `src/llm.ts` and in `queryGeneratorAgents.ts` if you want a different OpenAI model (ensure it supports Chat Completions and tools).
- Temperature is kept low (`0.1–0.2`) for predictable, parseable responses.

### Query Generator prompt / categories

- The Query Generator’s behavior is controlled by a system prompt and a few-shot example inside `queryGeneratorAgents.ts`.
- To tune behavior:
  - Add new categories (e.g., `MENTAL_HEALTH`, `DISABILITY_SERVICES`) and update the prompt description.
  - Adjust the example to emphasize new phrasing or additional `site:` filters.
  - Keep the **“exactly 10 lines, one query per line, no extra text”** requirement to keep downstream parsing simple.

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

```

```
