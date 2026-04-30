import { afterEach, describe, expect, it } from 'vitest';

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});

describe('OpenAI client module', () => {
  it('does not require OPENAI_API_KEY when imported', async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(import('../src/llm.ts')).resolves.toBeDefined();
  });
});
