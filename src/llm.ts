import type OpenAI from 'openai';

import type { AIMessage } from '../types';

import { openai } from './ai';
import { SYSTEM_PROMPT } from './systemPrompt';

export const runLLM = async ({
  messages,
  tools,
}: {
  messages: AIMessage[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
}) => {
  const req: Parameters<typeof openai.chat.completions.create>[0] = {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
  };

  if (tools.length > 0) {
    req.tools = tools;
    req.tool_choice = 'auto';
  }

  const res = await openai.chat.completions.create(req);
  if ('choices' in res) return res.choices[0].message;

  const buffers: Record<number, string> = {};
  let role = 'assistant';
  for await (const chunk of res as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
    if (!chunk.choices) continue;
    for (const c of chunk.choices) {
      const i = c.index ?? 0;
      if (c.delta?.role) role = c.delta.role;
      if (c.delta?.content) buffers[i] = (buffers[i] ?? '') + c.delta.content;
    }
  }
  return { role, content: buffers[0] ?? '' };
};
