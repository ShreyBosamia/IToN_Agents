import { describe, it, expect, beforeEach } from 'vitest';

import * as memory from '../src/memory';

describe('Memory Tool-call Dependency', () => {
  beforeEach(async () => {
    await memory.reset();
  });

  it('returns assistant + tool when limit=1 hits a tool message', async () => {
    const assistantMsg = {
      role: 'assistant',
      content: 'Calling tool',
      tool_calls: [{ id: 'abc123', function: { name: 'scrape_website', arguments: '{}' } }],
    };

    const toolMsg = {
      role: 'tool',
      content: 'tool output',
      tool_call_id: 'abc123',
    };

    await memory.addMessages([assistantMsg, toolMsg]);

    const result = await memory.getMessages(1);

    expect(result.length).toBe(2);
    expect(result[0]).toMatchObject(assistantMsg);
    expect(result[1]).toMatchObject(toolMsg);
  });
});
