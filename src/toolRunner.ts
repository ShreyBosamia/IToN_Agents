import type OpenAI from 'openai';

import type { RegisteredTool } from '../types';

export const runTool = async (
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  userMessage: string,
  tools: RegisteredTool[]
) => {
  const name = toolCall.function.name;
  let args: Record<string, unknown> = {};
  if (toolCall.function.arguments) {
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return JSON.stringify({
        error: 'Invalid tool argument JSON',
        name,
        raw: toolCall.function.arguments,
      });
    }
  }
  const impl = tools.find((t) => t.definition.function?.name === name);
  if (!impl) return JSON.stringify({ error: `Unknown tool: ${name}` });
  const out = await impl.handler({ toolArgs: args, userMessage });
  return typeof out === 'string' ? out : JSON.stringify(out);
};
