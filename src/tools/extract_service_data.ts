import { chromium } from 'playwright';
import fetch from 'node-fetch';
import TurndownService from 'turndown';
import type { RegisteredTool } from '../../types';

/**
 * A tool that fetches a community‐service webpage, extracts any `ld+json` data and
 * converts the visible content into Markdown.  It attempts a lightweight HTTP
 * fetch first and only falls back to Playwright for JavaScript‑heavy pages.
 *
 * The returned payload mirrors the shape expected by our agent pipeline: it
 * includes the original URL, a flag indicating whether Playwright was used,
 * a trimmed Markdown string, and any structured data objects parsed from
 * `application/ld+json` script tags.  Links are stripped to reduce token
 * overhead when passing the result into the LLM or downstream parsers.
 */
export const extractServiceDataTool: RegisteredTool = {
  definition: {
    type: 'function',
    function: {
      name: 'extract_service_data',
      description:
        'Fetch a community service page, extract any structured data (ld+json) and return clean Markdown. Uses a lightweight HTTP fetch when possible and falls back to Playwright for JavaScript‑heavy pages.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL of the community service page.' },
        },
        required: ['url'],
      },
    },
  },
  // We don't enforce a strict schema on the inputs here; OpenAI will ensure
  // the `url` property is present.
  schema: undefined as any,
  handler: async ({ toolArgs }) => {
    const { url } = toolArgs as { url: string };
    let html = '';
    let structuredData: any[] = [];
    let usedPlaywright = false;

    /**
     * Convert a raw HTML string into Markdown using Turndown.  Links are
     * stripped to save tokens, and fenced code blocks are preserved.
     */
    const convertHtmlToMarkdown = (htmlStr: string): string => {
      const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      // Remove link markup but keep the link text
      turndown.addRule('remove-links', {
        filter: ['a'],
        replacement: (content) => content,
      });
      try {
        return turndown.turndown(htmlStr);
      } catch {
        // If Turndown fails (e.g. on invalid HTML), return the original HTML
        return htmlStr;
      }
    };

    try {
      // Attempt a simple HTTP fetch first.  This handles the majority of static pages
      // without incurring the overhead of launching a browser.
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (DataScraper/1.0; +https://itn.example)',
          Accept: 'text/html',
        },
      });
      const text = await resp.text();
      html = text;
      // Extract any ld+json blocks from the returned HTML
      const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = scriptRegex.exec(text)) !== null) {
        const snippet = match[1].trim();
        if (!snippet) continue;
        try {
          structuredData.push(JSON.parse(snippet));
        } catch {
          // ignore malformed JSON
        }
      }
      // A very simple heuristic: if the page references large JS bundles or is
      // extremely long, assume it requires client‑side rendering and bail to
      // Playwright.  Without this check, dynamic sites would be returned
      // partially rendered.
      const isDynamic = /<script[^>]+src=["'][^"']+\.js/.test(text) || text.length > 200_000;
      if (isDynamic) throw new Error('dynamic page detected');
    } catch {
      // Fallback to Playwright for JavaScript‑heavy pages or network failures
      usedPlaywright = true;
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ locale: 'en-US' });
      const page = await context.newPage();
      // Block heavy resources to speed up page load
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'font', 'media', 'stylesheet'].includes(type)) return route.abort();
        route.continue();
      });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      // Extract ld+json scripts
      structuredData = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("script[type='application/ld+json']")).map((s) => {
          try {
            return JSON.parse(s.textContent || '');
          } catch {
            return null;
          }
        }).filter(Boolean);
      });
      // Remove non‑content elements to reduce Markdown noise
      await page.evaluate(() => {
        const junk = ['nav', 'footer', 'script', 'style', 'header', 'aside', 'iframe', 'noscript'];
        junk.forEach((tag) => {
          document.querySelectorAll(tag).forEach((el) => el.remove());
        });
      });
      html = await page.content();
      await browser.close();
    }
    const markdown = convertHtmlToMarkdown(html);
    return JSON.stringify({
      url,
      usedPlaywright,
      markdown: markdown.slice(0, 15_000),
      structuredData: structuredData.length > 0 ? structuredData : 'None found',
    });
  },
};