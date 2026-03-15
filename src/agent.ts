import { runLLM } from './llm.ts';
import { runTool } from './toolRunner.ts';
import type { AIMessage, RegisteredTool } from './types.ts';
import { logMessage, showLoader } from './ui.ts';

type AssistantMessage = Extract<AIMessage, { role: 'assistant' }>;

export const runAgent = async ({
  userMessage,
  tools,
  quiet = false,
}: {
  userMessage: string;
  tools: RegisteredTool[];
  quiet?: boolean;
}) => {
  const messages: AIMessage[] = [{ role: 'user', content: userMessage }];
  if (!quiet) logMessage({ role: 'user', content: userMessage });

  const loader = !quiet
    ? showLoader('Thinking...')
    : {
        stop: () => {},
        succeed: (_?: string) => {},
        fail: (_?: string) => {},
        update: (_: string) => {},
      };
  let jsonRetryCount = 0;

  while (true) {
    const response = await runLLM({
      messages,
      tools: tools.map((tool) => tool.definition),
    });

    const toolCalls =
      (response as any) && 'tool_calls' in (response as any)
        ? (response as any).tool_calls
        : undefined;

    const assistantMessage: AssistantMessage = {
      role: 'assistant',
      content: response.content ?? '',
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    };

    messages.push(assistantMessage);

    if (assistantMessage.tool_calls?.length) {
      if (!quiet) logMessage(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        let toolResponse: string;

        try {
          toolResponse = await runTool(toolCall, userMessage, tools);
        } catch (error) {
          toolResponse = JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            tool: toolCall.function.name,
          });
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResponse,
        });
      }

      continue;
    }

    if (assistantMessage.content) {
      // Try to ensure the assistant returned valid JSON. If not, retry once
      // with a short user prompt asking for JSON-only output.
      const raw =
        typeof assistantMessage.content === 'string'
          ? assistantMessage.content
          : JSON.stringify(assistantMessage.content || '');
      let parsedOk = false;
      try {
        JSON.parse(raw);
        parsedOk = true;
      } catch {
        // If full content isn't valid JSON, try to extract a top-level JSON
        // object from within the assistant response (handles fences or prose).
        const first = raw.indexOf('{');
        const last = raw.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
          try {
            JSON.parse(raw.slice(first, last + 1));
            parsedOk = true;
          } catch {
            parsedOk = false;
          }
        }
      }

      if (!parsedOk && jsonRetryCount === 0) {
        // Ask the assistant to return only the JSON (one retry).
        jsonRetryCount += 1;
        messages.push({
          role: 'user',
          content:
            'Please return ONLY valid JSON that matches the schema in the original prompt. Do not include any explanatory text or markdown. Respond with a single JSON object.',
        });
        // Log the non-JSON message for debugging (only when not quiet) and retry
        if (!quiet) logMessage(assistantMessage);
        continue;
      }

      loader.stop();
      if (!quiet) logMessage(assistantMessage);
      return messages;
    }
  }
};
