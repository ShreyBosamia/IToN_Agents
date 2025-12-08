import { describe, it, expect, beforeEach } from 'vitest';
import { addMessages, getMessages } from '../src/memory';
import { promises as fs } from 'fs';

const TEST_DB = 'db.json';

describe('Memory Robustness Tests', () => {
  beforeEach(async () => {
    await fs.writeFile(TEST_DB, JSON.stringify({ messages: [] }, null, 2));
  });

  it('handles message with null content without crashing', async () => {
    const badMsg = {
      role: 'user',
      content: null, // malformed
    };

    await addMessages([badMsg]);
    const result = await getMessages();

    expect(result.length).toBe(1);
    expect(result[0].role).toBe('user');
    // content may be null → must not crash
    expect(result[0].content).toBe(null);
  });

  it('handles assistant message with missing content field', async () => {
    const badMsg = {
      role: 'assistant',
      // missing content entirely
    };

    await addMessages([badMsg]);
    const result = await getMessages();

    expect(result.length).toBe(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBeUndefined();
  });

  it('handles malformed tool message without tool_call_id', async () => {
    const badMsg = {
      role: 'tool',
      content: 'tool output',
      // missing tool_call_id → malformed
    };

    await addMessages([badMsg]);
    const result = await getMessages();

    expect(result.length).toBe(1);
    expect(result[0].role).toBe('tool');
    expect(result[0].tool_call_id).toBeUndefined();
  });
});
