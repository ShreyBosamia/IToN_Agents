import { JSONFilePreset } from "lowdb/node";
import type { AIMessage } from "../types";

type Data = { messages: AIMessage[] };

const defaultData: Data = { messages: [] };

const TOOL_MAX = 16000;

export const getDb = async () => {
  const db = await JSONFilePreset<Data>("db.json", defaultData);
  return db;
};

export const addMessages = async (messages: AIMessage[]) => {
  const db = await getDb();
  const trimmed = messages.map((m) => {
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > TOOL_MAX) {
      return {
        ...m,
        content: m.content.slice(0, TOOL_MAX) + `\n...[truncated ${m.content.length - TOOL_MAX} chars]`,
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
  return all.slice(-limit);
};
