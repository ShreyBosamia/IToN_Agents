import { describe, it, expect } from 'vitest';

import { runTool } from '../src/toolRunner';
import type { RegisteredTool } from '../src/types';

const echoTool: RegisteredTool = {
  definition: {
    type: 'function',
    function: {
      name: 'echo',
      description: 'Echo back provided text',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  // @ts-expect-error simplified for test
  schema: undefined,
  handler: async ({ toolArgs }) => {
    return { echoed: (toolArgs as any).text };
  },
};

describe('runTool', () => {
  it('returns error for unknown tool', async () => {
    const res = await runTool(
      {
        id: '1',
        type: 'function',
        function: { name: 'missing', arguments: JSON.stringify({}) },
      } as any,
      'user msg',
      [echoTool]
    );
    expect(res).toContain('Unknown tool');
  });

  it('invokes tool and wraps non-string output', async () => {
    const res = await runTool(
      {
        id: '2',
        type: 'function',
        function: { name: 'echo', arguments: JSON.stringify({ text: 'hello' }) },
      } as any,
      'user msg',
      [echoTool]
    );
    expect(res).toContain('hello');
    expect(() => JSON.parse(res)).not.toThrow();
  });

  it('handles malformed JSON arguments gracefully', async () => {
    const bad = await runTool(
      {
        id: '3',
        type: 'function',
        function: { name: 'echo', arguments: '{ bad json' },
      } as any,
      'user msg',
      [echoTool]
    );
    // current implementation will throw; ensure test captures improvement suggestion
    // We expect this to surface a thrown error string.
    expect(typeof bad).toBe('string');
  });
});
