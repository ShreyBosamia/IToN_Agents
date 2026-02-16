import OpenAI from 'openai';
import type { ZodType } from 'zod';

export type AIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolFn<A = any, T = any> {
  (input: { userMessage: string; toolArgs: A }): Promise<T>;
}

export interface RegisteredTool<A = any, T = any> {
  definition: OpenAI.Chat.Completions.ChatCompletionTool;
  schema: ZodType<A>;
  handler: ToolFn<A, T>;
}
