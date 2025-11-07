import type { RegisteredTool } from "../types";
import type OpenAI from "openai";

export const runTool = async (
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  userMessage: string,
  tools: RegisteredTool[]
) => {
  const name = toolCall.function.name;
  const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
  const impl = tools.find((t) => t.definition.function?.name === name);
  if (!impl) return JSON.stringify({ error: `Unknown tool: ${name}` });
  const out = await impl.handler({ toolArgs: args, userMessage });
  return typeof out === "string" ? out : JSON.stringify(out);
};
