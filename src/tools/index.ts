import fetch from "node-fetch";
import { z } from "zod";
import type { RegisteredTool } from "../../types";

const MAX_CONTENT_LENGTH = 100_000;

const fetchHtmlArgsSchema = z.object({
  url: z.string().url(),
});

type FetchHtmlArgs = z.infer<typeof fetchHtmlArgsSchema>;

type FetchHtmlResult = {
  url: string;
  status: number;
  truncated: boolean;
  content: string;
};

const fetchHtmlTool: RegisteredTool<FetchHtmlArgs, FetchHtmlResult> = {
  definition: {
    type: "function",
    function: {
      name: "fetch_html_content",
      description:
        "Fetch the HTML content from a public webpage. Use this when you need the raw markup of a URL provided in the conversation.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "A fully-qualified URL to retrieve (must include protocol).",
          },
        },
        required: ["url"],
      },
    },
  },
  schema: fetchHtmlArgsSchema,
  handler: async ({ toolArgs }) => {
    const response = await fetch(toolArgs.url, {
      headers: {
        "User-Agent": "ai-agent-overview/1.0 (+https://github.com/)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const html = await response.text();
    const truncated = html.length > MAX_CONTENT_LENGTH;
    const content = truncated ? html.slice(0, MAX_CONTENT_LENGTH) : html;

    return {
      url: toolArgs.url,
      status: response.status,
      truncated,
      content,
    };
  },
};

export const tools: RegisteredTool[] = [fetchHtmlTool];
