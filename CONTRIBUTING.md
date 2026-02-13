# Contributing

Thanks for contributing! This repo is a TypeScript/Node.js project using ESLint, Prettier, and Vitest.

## Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm
- API keys (depending on what you run):
  - `OPENAI_API_KEY` (required for agent runs)
  - `BRAVE_SEARCH_API_KEY` (required for search/pipeline flows)

## Local setup

```bash
git clone https://github.com/ShreyBosamia/IToN_Agents.git
cd IToN_Agents
npm install
```

Create a `.env` file in the repo root:

```env
OPENAI_API_KEY=...
BRAVE_SEARCH_API_KEY=...
```

Run the project (examples):

```bash
npm run start -- "Summarize the content of the provided website."
npm run query -- "Salem" "OR" "FOOD_BANK"
npm run pipeline -- "Salem" "OR" "FOOD_BANK" 3 10
```

## Quality checks (run locally)

- Full CI-equivalent (recommended before opening a PR):

  ```bash
  npm run ci
  ```

- Tests:

  ```bash
  npm test
  npm run test:watch
  npm run coverage
  ```

- Lint:

  ```bash
  npm run lint
  npm run lint:fix
  ```

- Format:

  ```bash
  npm run format:check
  npm run format
  ```

## Contribution workflow

1. **Start with an Issue** (recommended)
   - Bugs: create a Bug Report issue.
   - Enhancements: create a Feature/Change Request issue with acceptance criteria.

2. **Create a branch** from `main`
   - Use a short, descriptive name:
     - `feat/<short-description>`
     - `fix/<short-description>`
     - `chore/<short-description>`
     - `docs/<short-description>`

3. **Make changes**
   - Keep PRs focused and reasonably small.
   - Add/adjust tests when behavior changes.
   - Update docs/examples when user-facing behavior changes.

4. **Open a Pull Request (PR)**
   - Title: clear and action-oriented.
   - Description should include:
     - What changed + why
     - Link to the Issue (e.g., `Fixes #123`)
     - How to test/verify (exact commands + sample inputs)
     - Any known limitations or follow-ups
   - Ensure the PR meets the Definition of Done (see below).

## Definition of Done (DoD)

A PR is considered “done” when:

- `npm run ci` passes locally (or CI is green)
- Changes are type-safe and don’t introduce new TypeScript errors
- Tests are added/updated for behavior changes (and are deterministic)
- No secrets are committed (keys belong only in `.env`)
- Docs/examples are updated if user-facing usage changed

## Code review expectations

- Expect at least **one reviewer** before merge.
- Address review comments or explain tradeoffs explicitly.
- Prefer clear code over clever code; keep interfaces stable unless required.
- If you change prompts, tools, or agent behavior, include before/after notes and how you evaluated the change.

## Reporting bugs / requesting changes

Use GitHub Issues in this repository.

**Bug reports should include:**

- Steps to reproduce (minimal)
- Expected vs. actual behavior
- OS + Node version
- Relevant logs/output (redact secrets)
- Example input files / CLI args (if applicable)

**Change requests should include:**

- Problem statement and who it helps
- Proposed behavior and acceptance criteria
- Any constraints (API limits, performance, data shape, etc.)

## Where to ask for help

- Open a GitHub Issue with the `question` label (or a normal issue if labels aren’t configured).
