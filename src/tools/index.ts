import { chromium } from "playwright";
import { z } from "zod";
import type { RegisteredTool } from "../../types";

const MAX_CONTENT_LENGTH = 100_000;

// --- Schema ---
const scrapeWebsiteArgsSchema = z.object({
  url: z.string().url(),
  waitForSelector: z
    .string()
    .optional()
    .describe("Optional CSS selector to wait for before scraping dynamic content"),
});

// --- Types ---
type ScrapeWebsiteArgs = z.infer<typeof scrapeWebsiteArgsSchema>;

type ScrapeWebsiteResult = {
  url: string;
  status: number;
  timestamp: string;
  truncated: boolean;
  metadata: {
    title?: string;
    description?: string;
    keywords?: string[];
  };
  data: {
    text: string;
    links: { text: string; href: string }[];
    htmlSnippet: string;
  };
};

// --- 3️⃣ Tool Definition ---
const scrapeWebsiteTool: RegisteredTool<ScrapeWebsiteArgs, ScrapeWebsiteResult> = {
  definition: {
    type: "function",
    function: {
      name: "scrape_website",
      description:
        "Use Playwright to scrape a fully rendered webpage and return structured metadata, text, and links.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Fully qualified URL to scrape (must include protocol).",
          },
          waitForSelector: {
            type: "string",
            description:
              "Optional CSS selector to wait for before scraping (useful for JS-heavy pages).",
          },
        },
        required: ["url"],
      },
    },
  },

  schema: scrapeWebsiteArgsSchema,

  // --- Handler ---
  handler: async ({ toolArgs }) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let status = 0;

    try {
      const response = await page.goto(toolArgs.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      status = response ? response.status() : 0;

      if (toolArgs.waitForSelector) {
        await page.waitForSelector(toolArgs.waitForSelector, { timeout: 10000 });
      }

      // --- Extract metadata, text, and links ---
      const metadata = await page.evaluate(() => {
        const metaDesc = document.querySelector("meta[name='description']")?.content || "";
        const metaKeys = document
          .querySelector("meta[name='keywords']")
          ?.content?.split(",")
          .map((k) => k.trim()) || [];
        const title = document.title || "";
        return { title, description: metaDesc, keywords: metaKeys };
      });

      const text = await page.evaluate(() => document.body.innerText || "");
      const links = await page.$$eval("a", (anchors) =>
        anchors
          .map((a) => ({
            text: a.textContent?.trim() || "",
            href: a.href,
          }))
          .filter((a) => a.href)
      );

      // --- Limit large payloads ---
      const html = await page.content();
      const truncated = html.length > MAX_CONTENT_LENGTH;
      const htmlSnippet = truncated ? html.slice(0, MAX_CONTENT_LENGTH) : html;

      await browser.close();

      return {
        url: toolArgs.url,
        status,
        timestamp: new Date().toISOString(),
        truncated,
        metadata,
        data: {
          text,
          links,
          htmlSnippet,
        },
      };
    } catch (err) {
      await browser.close();
      throw new Error(`Playwright scraping failed: ${err.message}`);
    }
  },
};

// Export
export const tools: RegisteredTool[] = [scrapeWebsiteTool];
