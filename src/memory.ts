import { JSONFilePreset } from 'lowdb/node';

import type { AIMessage } from '../types';

type Data = { messages: AIMessage[] };

const defaultData: Data = { messages: [] };

const TOOL_MAX = 16000;

export const getDb = async () => {
  const db = await JSONFilePreset<Data>('db.json', defaultData);
  return db;
};

export const addMessages = async (messages: AIMessage[]) => {
  const db = await getDb();
  const trimmed = messages.map((m) => {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > TOOL_MAX) {
      return {
        ...m,
        content:
          m.content.slice(0, TOOL_MAX) + `\n...[truncated ${m.content.length - TOOL_MAX} chars]`,
      };
    }
    return m;
  });
  db.data.messages.push(...trimmed);
  await db.write();
};

export const getMessages = async (limit?: number) => {
  const db = await getDb();
  const all = db.data.messages;
  if (!limit || all.length <= limit) return all;
  // Start with the last `limit` messages.
  let start = Math.max(0, all.length - limit);

  // If any 'tool' message in the slice refers to an assistant message that falls
  // before `start`, expand the slice so that the assistant message with the
  // matching `tool_calls` is included. This prevents sending a `tool` message
  // to the API without the preceding assistant message that contains
  // `tool_calls` (which the API requires).
  const adjustForToolDependencies = () => {
    const slice = all.slice(start);
    for (let i = 0; i < slice.length; i++) {
      const msg = slice[i] as any;
      if (msg.role === 'tool' && msg.tool_call_id) {
        const toolCallId = msg.tool_call_id;

        // Find the assistant message that contains the corresponding tool_calls
        // in the full message history.
        const assistantIndex = all.findIndex((m: any, _idx: number) => {
          return (
            m.role === 'assistant' &&
            Array.isArray(m.tool_calls) &&
            m.tool_calls.some((tc: any) => tc.id === toolCallId)
          );
        });

        if (assistantIndex !== -1 && assistantIndex < start) {
          // Expand the window to include that assistant message.
          start = assistantIndex;
          // Since start changed, we need to re-check the slice from the top.
          return true;
        }
      }
    }
    return false;
  };

  // Keep adjusting until no dependencies force us to expand the slice.
  while (adjustForToolDependencies()) {
    // loop
  }

  return all.slice(start);
};
