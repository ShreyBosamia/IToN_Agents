import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { addMessages, getMessages } from '../src/memory';

// Helper to reset the underlying lowdb file before each test so tests are isolated.
async function resetDb() {
  await fs.writeFile('db.json', JSON.stringify({ messages: [] }, null, 2));
}

describe('memory.getMessages', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns the last N messages when no tool dependency expansion is needed', async () => {
    await addMessages([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' }
    ]);

    const slice = await getMessages(3); // expect last 3: a1, u2, a2
    expect(slice.length).toBe(3);
    expect(slice.map(m => m.content)).toEqual(['a1', 'u2', 'a2']);
  });

  it('expands slice to include assistant tool_calls that precede tool messages', async () => {
    // Sequence: assistant(tool_calls) -> tool -> assistant -> user
    const toolCallId = 'tc_1';
    await addMessages([
      { role: 'assistant', content: '', tool_calls: [ { id: toolCallId, type: 'function', function: { name: 'dummy', arguments: '{}' } } ] as any },
      { role: 'tool', tool_call_id: toolCallId, content: '{"ok":true}' },
      { role: 'assistant', content: 'plain assistant' },
      { role: 'user', content: 'final user' }
    ]);

  // Ask for last 3 messages; slice would start at index 1 (tool, assistant, user) then expand backwards to include the assistant with tool_calls.
  const slice = await getMessages(3);
    // Expect expansion pulled in the previous tool message and the assistant with tool_calls.
    const roles = slice.map(m => m.role);
  expect(roles).toEqual(['assistant', 'tool', 'assistant', 'user']);
    // Verify the first assistant has tool_calls.
    const firstAssistant: any = slice[0];
    expect(Array.isArray(firstAssistant.tool_calls)).toBe(true);
    expect(firstAssistant.tool_calls[0].id).toBe(toolCallId);
  });
});
