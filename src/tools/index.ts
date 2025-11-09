import { chromium } from "playwright";

import type { RegisteredTool } from "../../types";

const MAX_TEXT = 8000;
const MAX_HTML = 12000;

export const tools: RegisteredTool[] = [
  {
    definition: {
      type: "function",
      function: {
        name: "scrape_website",
        description: "Render a page and return trimmed text, links, and meta",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL with protocol" },
            waitForSelector: {
              type: "string",
              description: "Optional CSS selector to await",
            },
          },
          required: ["url"],
        },
      },
    },
    schema: undefined as any,
    handler: async ({ toolArgs }) => {
      const { url, waitForSelector } = toolArgs as {
        url: string;
        waitForSelector?: string;
      };

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      let status = 0;

      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        status = resp ? resp.status() : 0;

        if (waitForSelector) {
          await page.waitForSelector(waitForSelector, { timeout: 15000 });
        }

        const title = await page.title();
        const description = await page.evaluate(
          () => document.querySelector<HTMLMetaElement>("meta[name='description']")?.content || ""
        );
        const keywords = await page.evaluate(() =>
          (document.querySelector<HTMLMetaElement>("meta[name='keywords']")?.content || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        );

        const fullText = await page.evaluate(() => document.body?.innerText || "");
        const text = fullText.slice(0, MAX_TEXT);

        const links = await page.$$eval("a", (as) =>
          as
            .map((a) => ({ text: (a.textContent || "").trim(), href: (a as HTMLAnchorElement).href }))
            .filter((x) => !!x.href)
            .slice(0, 300)
        );

        const html = await page.content();
        const htmlSnippet = html.slice(0, MAX_HTML);

        const payload = {
          url,
          status,
          timestamp: new Date().toISOString(),
          metadata: { title, description, keywords },
          data: { text, links, htmlSnippet },
          truncated: {
            text: fullText.length > text.length,
            html: html.length > htmlSnippet.length,
          },
        };

        await browser.close();
        return JSON.stringify(payload);
      } catch (e: any) {
        await browser.close();
        return JSON.stringify({ error: `Playwright failed: ${e?.message || String(e)}`, url, status });
      }
    },
  },
];
