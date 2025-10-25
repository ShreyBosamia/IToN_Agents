import type OpenAI from "openai";
import type { RegisteredTool } from "../types";

export const runTool = async (
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  userMessage: string,
  tools: RegisteredTool[]
) => {
  const functionName = toolCall.function.name;
  const tool = tools.find(
    (candidate) => candidate.definition.function.name === functionName
  );

  if (!tool) {
    return JSON.stringify({
      error: `Tool "${functionName}" is not implemented.`,
    });
  }

  let rawArgs: unknown;

  try {
    rawArgs = toolCall.function.arguments
      ? JSON.parse(toolCall.function.arguments)
      : {};
  } catch (error) {
    return JSON.stringify({
      error: "Received malformed JSON arguments.",
      details: `${error}`,
    });
  }

  const parsedArgs = tool.schema.safeParse(rawArgs);

  if (!parsedArgs.success) {
    return JSON.stringify({
      error: "Tool arguments failed validation.",
      issues: parsedArgs.error.issues,
    });
  }

  try {
    const result = await tool.handler({
      userMessage,
      toolArgs: parsedArgs.data,
    });

    if (typeof result === "string") {
      return result;
    }

    return JSON.stringify(result);
  } catch (error) {
    if (error instanceof Error) {
      return JSON.stringify({
        error: "Tool execution failed.",
        details: error.message,
      });
    }

    return JSON.stringify({
      error: "Tool execution failed.",
      details: `${error}`,
    });
  }
};
