import type { AIMessage, RegisteredTool } from '../types';

import { runLLM } from './llm';
import { addMessages, getMessages } from './memory';
import { runTool } from './toolRunner';
import { logMessage, showLoader } from './ui';

type AssistantMessage = Extract<AIMessage, { role: 'assistant' }>;

export const runAgent = async ({
  userMessage,
  tools,
}: {
  userMessage: string;
  tools: RegisteredTool[];
}) => {
  await addMessages([{ role: 'user', content: userMessage }]);
  logMessage({ role: 'user', content: userMessage });

  const loader = showLoader('Thinking...');
  let jsonRetryCount = 0;

  while (true) {
    const history = await getMessages(20);
    const response = await runLLM({
      messages: history,
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

    await addMessages([assistantMessage]);

    if (assistantMessage.tool_calls?.length) {
      logMessage(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const toolResponse = await runTool(toolCall, userMessage, tools);
        await addMessages([{ role: 'tool', tool_call_id: toolCall.id, content: toolResponse }]);
      }

      await addMessages([{ role: 'user', content: 'Summarize the final contact info.' }]);
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
        await addMessages([
          {
            role: 'user',
            content:
              'Please return ONLY valid JSON that matches the schema in the original prompt. Do not include any explanatory text or markdown. Respond with a single JSON object.'
          },
        ]);
        // Log the non-JSON message for debugging and continue the loop to retry
        logMessage(assistantMessage);
        continue;
      }

      loader.stop();
      logMessage(assistantMessage);
      return getMessages(20);
    }
  }
};
