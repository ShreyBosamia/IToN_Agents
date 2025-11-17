# AI Agent Overview

A minimal TypeScript agent that calls OpenAI’s Chat Completions API with tool calling. It can fetch and analyze the HTML of a target webpage defined in the system prompt, then summarize or extract details from it.

## Prerequisites

- Node.js 18+ (tested on Node 20)
- An OpenAI API key

## Setup

1. Install dependencies

```
npm install
```

2. Configure environment

- Create a `.env` file in the project root with:

```
OPENAI_API_KEY=your_openai_api_key
```

Note: the env variable name is `OPENAI_API_KEY` (no extra underscore).

3. Target website (optional)

- The default target URL is set in `src/systemPrompt.ts`. Update the `<context>...</context>` URL if you want the agent to analyze a different site.

## Usage

You can pass a prompt directly via npm scripts. Use `--` so arguments pass through to the script.

```
npm start -- "Summarize the content of the provided website."
```

Equivalents:

- `npm run start -- "Find the clinic hours and phone numbers."`
- `npx tsx index.ts "Extract address and contacts from the page."`

## What it does

- Sends your prompt plus a system instruction to OpenAI (`gpt-4o-mini`).
- If needed, the model auto-invokes the `fetch_html_content` tool to retrieve the page’s HTML.
- The tool returns the raw HTML (truncated for safety), which is fed back to the model.
- The model reasons over the content and responds with the requested summary/details.

Key files:

- `index.ts` – CLI entrypoint
- `src/agent.ts` – conversation loop, tool execution
- `src/llm.ts` – OpenAI call setup (model, tools)
- `src/tools/index.ts` – `fetch_html_content` tool implementation
- `src/systemPrompt.ts` – system instructions and target URL
- `src/memory.ts` – lightweight message storage (`db.json`)

## Customization

- Change the model in `src/llm.ts` if desired (ensure it supports function calling/tools).
- Add more tools in `src/tools` and register them in `src/tools/index.ts`.
- Adjust truncation limits or headers in the fetch tool.

## Troubleshooting

- If the agent doesn’t fetch the page when it should, explicitly ask it to “use the fetch_html_content tool” or set `tool_choice: "required"` in `src/llm.ts` for strict flows.
- If arguments don’t reach your script, ensure you used `--` after `npm start`.
- Rotate your OpenAI key if you accidentally exposed it. Keep `.env` out of version control.

## Development & quality

Common tasks:

- Run all tests:

```
npm run ci
```

- Lint (ESLint):

```
npm run lint
```

- Auto-fix lint issues where possible:

```
npm run lint:fix
```

- Format (Prettier):

```
npm run format
```

- Check formatting only:

```
npm run format:check
```

- Run tests (Vitest):

```
npm test
```

- Watch tests during development:

```
npm run test:watch
```

- Coverage report:

```
npm run coverage
```

### CI

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on push/PR and does the following:
- Install dependencies
- Lint
- Prettier check
- Tests (with coverage uploaded as an artifact) for batch runs.
