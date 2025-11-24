// @ts-nocheck
/// <reference types="vitest" />

import { beforeEach, describe, expect, it } from "vitest";
import { getDb, addMessages, getMessages } from "../src/memory";
import type { AIMessage } from "../src/types";

const makeUserMessage = (content: string): AIMessage => ({
  role: "user",
  content,
});

const makeToolMessage = (content: string): AIMessage =>
  ({
    role: "tool",
    content,
    tool_call_id: "test-call",
  } as any as AIMessage);

describe("memory module", () => {
  beforeEach(async () => {
    const db = await getDb();
    db.data.messages = [];
    await db.write();
  });

  it("stores and returns a user message", async () => {
    await addMessages([makeUserMessage("hello world")]);
    const msgs = await getMessages();

    expect(msgs.length).toBeGreaterThan(0);
    const last = msgs[msgs.length - 1];

    expect(last.role).toBe("user");
    expect(last.content).toBe("hello world");
  });

  it("truncates very long tool messages", async () => {
    const longContent = "x".repeat(20000);

    await addMessages([makeToolMessage(longContent)]);
    const msgs = await getMessages();
    const last = msgs[msgs.length - 1];

    expect(last.role).toBe("tool");
    expect(typeof last.content).toBe("string");

    const content = last.content as string;
    expect(content).toContain("...[truncated");
    expect(content.length).toBeLessThan(longContent.length);
  });
});
