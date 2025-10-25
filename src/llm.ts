import type OpenAI from "openai";
import type { AIMessage } from "../types";
import { openai } from "./ai";
import { systemPrompt } from "./systemPrompt";
export const runLLM = async ({
  messages,
  tools,
}: {
  messages: AIMessage[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
}) => {
  const request: Parameters<typeof openai.chat.completions.create>[0] = {
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  };

  if (tools.length > 0) {
    request.tools = tools;
    request.tool_choice = "auto";
    request.parallel_tool_calls = false;
  }

  const response = await openai.chat.completions.create(request);

  // Handle both non-stream and streaming responses
  if ("choices" in response && Array.isArray(response.choices)) {
    return response.choices[0].message;
  } else {
    // response is a stream (AsyncIterable of ChatCompletionChunk)
    const buffers: Record<number, string> = {};
    let role = "assistant";

    for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
      if (!chunk.choices) continue;
      for (const choice of chunk.choices) {
        const idx = choice.index ?? 0;
        if (choice.delta?.role) role = choice.delta.role;
        if (choice.delta?.content) {
          buffers[idx] = (buffers[idx] ?? "") + choice.delta.content;
        }
      }
    }

    const content = buffers[0] ?? "";
    return { role, content };
  }
};
