# In Time of Need — AI Agent Pipeline

**An AI-powered pipeline that automatically discovers, extracts, and normalizes local social service resources — food banks, shelters, and more — from across the web.**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/) [![CI](https://github.com/ShreyBosamia/IToN_Agents/actions/workflows/ci.yml/badge.svg)](https://github.com/ShreyBosamia/IToN_Agents/actions)

**[View GitHub](https://github.com/ShreyBosamia/IToN_Agents) · [Get Started](#getting-started) · [Report an Issue](https://github.com/ShreyBosamia/IToN_Agents/issues)**

---

## The Problem

Community resource directories — listing food banks, homeless shelters, addiction services, and other local aid — go stale fast. Organizations move, change hours, or shut down. Keeping that data accurate requires manual research across hundreds of websites, which is slow, expensive, and hard to scale.

**IToN Agents solves this by automating the entire discovery and extraction workflow**, turning a city, state, and resource category into structured, reviewable JSON data — ready to feed into a live resource directory.

---

## How It Works

<img src="docs/adr/images/diagram.png" alt="Pipeline architecture diagram showing staff input flowing through Query Generator, Search Agent, and Web Scraper agents in the cloud, producing JSON output that staff review before publishing to Sanity CMS" width="400">

_Staff submit a city, state, and resource category; AI agents in the cloud generate queries, search the web, scrape sites, and extract structured data; staff review and approve results before they publish to the Sanity CMS database._

1. **Query Generation** — an AI agent crafts 10 high-quality, city-specific search queries per resource category using few-shot prompting.
2. **Web Search** — queries are sent to the Brave Search API; results are deduplicated across all 10 queries.
3. **Scraping** — the pipeline now uses **Firecrawl first** for managed scraping and falls back to **Playwright** when a page needs browser-based recovery.
4. **Extraction** — a second AI agent reads each page and outputs structured JSON: organization name, address, hours, services, phone, and website.
5. **Human Review** — extracted data is staged in a job queue; a React UI lets staff approve or reject results before anything reaches production.

---

## Key Features

- **AI Query Generation** — generates exactly 10 optimized search queries per city/state/category, validated with automatic repair-retry if the output format is wrong.
- **Brave Search Integration** — searches all queries via the Brave Search API and deduplicates discovered URLs, maximizing coverage while minimizing redundant scraping.
- **Hybrid Scraping** — Firecrawl is the default managed scrape layer, with Playwright fallback for harder or more dynamic sites.
- **Structured Data Extraction** — `gpt-4o-mini` reads scraped content and outputs consistent JSON fields (name, address, hours, phone, services, website) across all resource types.
- **Human-in-the-Loop Approval** — an HTTP job server exposes a review API and a React frontend so staff can approve or deny pipeline output before it's published to the live directory.

---

## Demo & Sample Output

<img src="docs/adr/images/pipeline-output.png" alt="Terminal screenshot showing npm run pipeline command for Corvallis OR Food_Bank, with the pipeline saving query, output, and sanity JSON files, then printing the extracted South Corvallis Food Bank record including address, hours, and contact info" width="700">

_Running `npm run pipeline:auto -- "Corvallis" "OR" "FOOD_BANK" 1 1` — the pipeline generates queries, scrapes the web, and outputs a structured JSON record in seconds._

> See more examples in [`examples/Portland_Homeless_shelter_pipeline.json`](examples/Portland_Homeless_shelter_pipeline.json) and [`examples/Salem_FOOD_BANK_queries.txt`](examples/Salem_FOOD_BANK_queries.txt).

---

## Getting Started

**Requirements:** Node.js 18+, an [OpenAI API key](https://platform.openai.com/), a [Brave Search API key](https://brave.com/search/api/), and a Firecrawl API key for the default scraper path.

```bash
# 1. Clone and install
git clone https://github.com/ShreyBosamia/IToN_Agents.git
cd IToN_Agents
npm install

# 2. Add your API keys and scraper settings
cat >> .env <<'ENV'
OPENAI_API_KEY=your_key_here
BRAVE_SEARCH_API_KEY=your_key_here
FIRECRAWL_API_KEY=your_key_here
SCRAPER_PROVIDER=auto
FIRECRAWL_TIMEOUT_MS=30000
FIRECRAWL_MAX_AGE_MS=0
ENV

# 3. Run the full pipeline
npm run pipeline:auto -- "Salem" "OR" "FOOD_BANK"
```

Important notes:

- `SCRAPER_PROVIDER=auto` is the default recommended mode: Firecrawl first, Playwright fallback.
- You can force a provider for comparison:
  - `npm run pipeline:firecrawl -- "Salem" "OR" "FOOD_BANK"`
  - `npm run pipeline:playwright -- "Salem" "OR" "FOOD_BANK"`
- Output is written to `outputs/<City>_<CATEGORY>_pipeline.json` and `outputs/<City>_<CATEGORY>_sanity.json`.

Useful commands:

```bash
# Query generation only
npm run query -- "Salem" "OR" "FOOD_BANK"

# Firecrawl directory map/crawl experiment
npm run firecrawl:experiment -- "https://www.feedingillinois.org/food-banks"

# HTTP review server
npm run server
```

For full CLI reference, server setup, and development commands, see **[SETUP.md](SETUP.md)**.

---

## Scraping Notes

The public `scrape_website` contract is unchanged, but scrape results now include extra provider diagnostics:

- `provider` — which backend produced the final result
- `provider_attempts` — ordered scrape attempts and fallback reasons
- `raw_provider_metadata` — provider-specific debug metadata

This makes it easier to compare Firecrawl vs. Playwright behavior while keeping downstream extraction stable.

---

## Key Files

- `index.ts` – CLI entrypoint for the original HTML-analysis agent.
- `src/agent.ts` – conversation loop, tool execution.
- `src/llm.ts` – OpenAI call setup (model, tools).
- `src/tools/index.ts` – tool registry.
- `src/tools/scrapeWebsite.ts` – `scrape_website` provider routing, normalization, and Firecrawl/Playwright implementations.
- `src/systemPrompt.ts` – system instructions and target URL.
- `src/memory.ts` – lightweight message storage (`db.json`).
- `src/agents/queryGenerator.ts` – Query Generator functions:
  - `runQueryGenerator(city, state, category)` → returns 10 queries as a `string[]`
  - `saveQueriesToFile(city, category, queries)` → writes the `.txt` query file
- `scripts/queryGeneratorCli.ts` – CLI wrapper for the Query Generator.
- `src/agents/searchAgent.ts` – Search Agent functions (Brave Search API).
- `scripts/pipeline.ts` – deterministic pipeline runner.
- `scripts/firecrawlDirectoryExperiment.ts` – Firecrawl `map`/`crawl` experiment for directory evaluation.

---

## Contacts

| Name            | GitHub                                             |
| --------------- | -------------------------------------------------- |
| Bailey Bounnam  | [@BaileyBounnam](https://github.com/BaileyBounnam) |
| Adam Nguyen     | [@nguyenadamq](https://github.com/nguyenadamq)     |
| Shrey Bosamia   | [@ShreyBosamia](https://github.com/ShreyBosamia)   |
| Sungsoo Kim     | [@nalchamchi](https://github.com/nalchamchi)       |
| Sierra Sverdrup | [@N8tur3](https://github.com/N8tur3)               |

**Questions or feedback?** [Open an issue](https://github.com/ShreyBosamia/IToN_Agents/issues) on GitHub.
