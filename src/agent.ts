import type { AIMessage, RegisteredTool } from "../types";
import { runLLM } from "./llm";
import { runTool } from "./toolRunner";
import { logMessage, showLoader } from "./ui";
import { addMessages, getMessages } from "./memory";

type AssistantMessage = Extract<AIMessage, { role: "assistant" }>;

export const runAgent = async ({
  userMessage,
  tools,
}: {
  userMessage: string;
  tools: RegisteredTool[];
}) => {
  await addMessages([{ role: "user", content: userMessage }]);
  logMessage({ role: "user", content: userMessage });

  const loader = showLoader("Thinking...");

  while (true) {
    const history = await getMessages(20);
    const response = await runLLM({
      messages: history,
      tools: tools.map((tool) => tool.definition),
    });

    const assistantMessage: AssistantMessage = {
      role: "assistant",
      content: response.content ?? "",
      ...(response.tool_calls ? { tool_calls: response.tool_calls } : {}),
    };

    await addMessages([assistantMessage]);

    if (assistantMessage.tool_calls?.length) {
      logMessage(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const toolResponse = await runTool(toolCall, userMessage, tools);
        await addMessages([{ role: "tool", tool_call_id: toolCall.id, content: toolResponse }]);
      }

      await addMessages([{ role: "user", content: "Summarize the final contact info." }]);
      continue;
    }

    if (assistantMessage.content) {
      loader.stop();
      logMessage(assistantMessage);
      return getMessages(20);
    }
  }
};
