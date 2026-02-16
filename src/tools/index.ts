import { createHash } from 'crypto';

import { chromium } from 'playwright';

import type { RegisteredTool } from '../types';

const MAX_TEXT = 8000;
const MAX_HTML = 12000;
const MAX_LINKS = 300;

export const tools: RegisteredTool[] = [
  {
    definition: {
      type: 'function',
      function: {
        name: 'scrape_website',
        description: 'Render a page and return trimmed text, links, and meta',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL with protocol' },
            waitForSelector: {
              type: 'string',
              description: 'Optional CSS selector to await',
            },
            /** Optional: wait for network to go idle briefly after DOM ready (milliseconds). */
            waitForNetworkIdleMs: { type: 'number' },
          },
          required: ['url'],
        },
      },
    },
    schema: undefined as any,
    handler: async ({ toolArgs }) => {
      const { url, waitForSelector, waitForNetworkIdleMs } = toolArgs as {
        url: string;
        waitForSelector?: string;
        waitForNetworkIdleMs?: number;
      };

      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: undefined, // let Playwright pick a reasonable UA
        locale: 'en-US',
      });
      const page = await context.newPage();

      // Speed & stability: block heavy resources (images, fonts, media, etc.)
      await page.route('**/*', (route) => {
        const t = route.request().resourceType();
        if (['image', 'media', 'font', 'stylesheet', 'websocket'].includes(t)) {
          return route.abort();
        }
        route.continue();
      });

      page.setDefaultNavigationTimeout(30_000);

      let status = 0;
      let headers: Record<string, string> = {};
      let finalUrl = url;

      const fetchStartedAt = new Date().toISOString();

      try {
        const resp = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        if (resp) {
          status = resp.status();
          // NOTE: header names are lowercased in Playwright
          headers = await resp.headers();
          finalUrl = resp.url();
        } else {
          status = 0;
          finalUrl = page.url() || url;
        }

        // Optional deterministic “extra wait”
        if (waitForSelector) {
          await page.waitForSelector(waitForSelector, { timeout: 15_000 });
        } else if (waitForNetworkIdleMs && waitForNetworkIdleMs > 0) {
          await page.waitForLoadState('networkidle', {
            timeout: Math.min(waitForNetworkIdleMs, 10_000),
          });
        }

        // Basic meta
        const title = await page.title();

        const description = await page.evaluate(() => {
          const el = document.querySelector("meta[name='description']");
          return el ? el.getAttribute('content') || '' : '';
        });

        const keywords = await page.evaluate(() => {
          const el = document.querySelector("meta[name='keywords']");
          const raw = el ? el.getAttribute('content') || '' : '';
          return raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        });

        // Canonical, robots, OpenGraph, and ld+json
        const metaExtras = await page.evaluate(() => {
          const og = {
            title:
              document.querySelector("meta[property='og:title']")?.getAttribute('content') || '',
            description:
              document.querySelector("meta[property='og:description']")?.getAttribute('content') ||
              '',
            locale:
              document.querySelector("meta[property='og:locale']")?.getAttribute('content') || '',
            url: document.querySelector("meta[property='og:url']")?.getAttribute('content') || '',
          };

          const canonicalEl = document.querySelector("link[rel='canonical']");
          const canonical = canonicalEl ? canonicalEl.getAttribute('href') || '' : '';

          const robotsEl = document.querySelector("meta[name='robots']");
          const robots = robotsEl ? robotsEl.getAttribute('content') || '' : '';

          const scripts = Array.from(
            document.querySelectorAll("script[type='application/ld+json']")
          );
          const ld_json = [];
          for (const s of scripts) {
            const txt = (s.textContent || '').trim();
            if (!txt) continue;
            try {
              // remove JS-style comments that sometimes sneak in
              const cleaned = txt.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/g, '');
              ld_json.push(JSON.parse(cleaned));
            } catch {
              // ignore bad blocks
            }
          }

          const mainEl = document.querySelector('main, article');
          const mainText =
            (mainEl && (mainEl.textContent || '').trim()) ||
            (document.body && (document.body.innerText || '').trim()) ||
            '';

          return { canonical, robots, og, ld_json, mainText };
        });

        // Text (trimmed) – keep a flag if truncated
        const fullText = (metaExtras.mainText || '').toString();
        const text = fullText.slice(0, MAX_TEXT);

        // Links (resolved to absolute; include text + rel)
        const links = await page.$$eval(
          'a',
          (as, args) => {
            const { baseHref, maxLinks } = args as { baseHref: string; maxLinks: number };
            const out: Array<{ href: string; text: string; rel: string }> = [];
            const seen = new Set<string>();
            for (const a of as as HTMLAnchorElement[]) {
              const rawHref = a.getAttribute('href') || '';
              let href = '';
              try {
                href = new URL(rawHref, baseHref).href;
              } catch {
                continue;
              }
              if (!href || seen.has(href)) continue;
              seen.add(href);
              out.push({
                href,
                text: (a.textContent || '').trim(),
                rel: (a.getAttribute('rel') || '').toLowerCase(),
              });
              if (out.length >= maxLinks) break;
            }
            return out;
          },
          { baseHref: finalUrl, maxLinks: MAX_LINKS }
        );

        // HTML snapshot (trimmed) + DOM hash (helps you detect real changes)
        const html = await page.content();
        const htmlSnippet = html.slice(0, MAX_HTML);
        const dom_hash = createHash('sha256').update(html).digest('hex');

        const timestamp = new Date().toISOString();

        const payload = {
          url,
          final_url: finalUrl,
          status,
          fetched_at: fetchStartedAt,
          finished_at: timestamp,
          headers,
          dom_hash,
          metadata: {
            title,
            description,
            keywords,
            canonical: metaExtras.canonical,
            robots: metaExtras.robots,
            og: metaExtras.og,
            ld_json: metaExtras.ld_json,
          },
          data: {
            text,
            links,
            htmlSnippet,
          },
          truncated: {
            text: fullText.length > text.length,
            html: html.length > htmlSnippet.length,
          },
        };

        return JSON.stringify(payload);
      } catch (e: any) {
        return JSON.stringify({
          error: `Playwright failed: ${e?.message || String(e)}`,
          url,
          final_url: finalUrl,
          status,
          fetched_at: fetchStartedAt,
          finished_at: new Date().toISOString(),
        });
      } finally {
        // Always clean up even if an exception is thrown
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    },
  },
];
