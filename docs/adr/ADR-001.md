# ADR-001: Use Playwright for Web Scraping

**Status:** Accepted

## Context

Our project requires extracting data from many third-party websites with inconsistent structures and frequent use of JavaScript for rendering content. We need a scraping method that reliably handles dynamic pages and provides stable, auditable snapshots for downstream AI normalization.

## Decision

We will use **Playwright (headless Chromium)** as the primary tool for web scraping and page rendering. It will serve as the default fetch-and-render layer before passing structured content to our AI extraction pipeline.

## Options Considered

- **Do nothing (basic HTTP fetch)**
  - Simple but fails on JavaScript-rendered content.

- **Playwright (chosen)**
  - Reliable handling of dynamic sites, strong control over rendering, stable snapshots.

- **Puppeteer**
  - Similar, but Playwright offers better cross-browser support and tooling.

- **Selenium/WebDriver**
  - Heavier and slower for our use case.

- **Scraping APIs (Zyte, Diffbot, etc.)**
  - Lower maintenance but costly and inflexible.

## Consequences

### Positive

- Correctly handles JavaScript-heavy pages.
- Produces consistent snapshots for debugging and normalization.
- Integrates cleanly with CI and our existing Node.js pipeline.

### Negative

- Higher runtime cost than simple HTTP fetch.
- Requires managing browser dependencies in CI.
- Needs safeguards against anti-bot protections.

## References

- [Playwright documentation] (https://playwright.dev/docs/intro)
- Internal GitHub issues related to scraping pipeline and prototype validation.
