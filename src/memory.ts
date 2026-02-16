import { JSONFilePreset } from 'lowdb/node';

import type { AIMessage } from './types';

type Data = { messages: AIMessage[] };

const defaultData: Data = { messages: [] };

const TOOL_MAX = 16000;

let DB_PATH = 'db.json';
export const setDbPath = (path: string) => {
  DB_PATH = path;
};

export const getDb = async () => {
  const db = await JSONFilePreset<Data>(DB_PATH, defaultData);
  return db;
};

export const addMessages = async (messages: AIMessage[]) => {
  const db = await getDb();
  const validMessages = messages.filter((m) => {
    if (!m) return false; // null, undefined
    if (typeof m !== 'object') return false; // primitive types
    if (!('role' in m)) return false; // role missing → DROP
    return true; // assistant/tool invalid fields allowed
  });
  if (validMessages.length === 0) return;
  const trimmed = validMessages.map((m) => {
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

export const resetMessages = async () => {
  const db = await getDb();
  db.data.messages = [];
  await db.write();
};

export const getMessages = async (limit?: number) => {
  const db = await getDb();
  const all = db.data.messages;

  // Default to returning the most recent 1 message
  const effectiveLimit = limit ?? 1;

  if (all.length <= effectiveLimit) return all;

  let start = Math.max(0, all.length - effectiveLimit);

  const adjustForToolDependencies = () => {
    const slice = all.slice(start);
    for (let i = 0; i < slice.length; i++) {
      const msg = slice[i] as any;
      if (msg.role === 'tool' && msg.tool_call_id) {
        const toolCallId = msg.tool_call_id;
        const assistantIndex = all.findIndex((m: any) => {
          return (
            m.role === 'assistant' &&
            Array.isArray(m.tool_calls) &&
            m.tool_calls.some((tc: any) => tc.id === toolCallId)
          );
        });
        if (assistantIndex !== -1 && assistantIndex < start) {
          start = assistantIndex;
          return true;
        }
      }
    }
    return false;
  };
  //FIX: no-empty error
  while (adjustForToolDependencies()) {
    // no-op to satisfy eslint
  }
  return all.slice(start);
};

export const reset = async () => {
  const db = await getDb();
  db.data.messages = [];
  await db.write();
};
