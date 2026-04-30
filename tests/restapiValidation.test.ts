import { describe, expect, it } from 'vitest';

import { validatePipelineRequest } from '../pipeline/validatePipelineRequest.ts';

describe('REST API pipeline request validation', () => {
  it('normalizes valid pipeline input', () => {
    const result = validatePipelineRequest({
      city: ' Salem ',
      state: ' OR ',
      category: 'FOOD_BANK',
      perQuery: 3,
      maxUrls: 10,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        city: 'Salem',
        state: 'OR',
        category: 'FOOD_BANK',
        perQuery: 3,
        maxUrls: 10,
      },
    });
  });

  it('omits optional pipeline limits when they are not provided', () => {
    const result = validatePipelineRequest({
      city: 'Portland',
      state: 'OR',
      category: 'SHELTER',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        city: 'Portland',
        state: 'OR',
        category: 'SHELTER',
      },
    });
  });

  it('returns all validation errors and rejects non-pipeline fields', () => {
    const result = validatePipelineRequest({
      city: '',
      state: 'OR',
      category: 'food bank',
      maxQueries: 3,
      perQuery: 0,
      maxUrls: 1.5,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toEqual([
      {
        field: 'maxQueries',
        message:
          'Unknown field "maxQueries". Allowed fields: city, state, category, perQuery, maxUrls.',
      },
      { field: 'city', message: 'city is required.' },
      {
        field: 'category',
        message: 'category must use UPPER_SNAKE_CASE letters, numbers, and underscores.',
      },
      { field: 'perQuery', message: 'perQuery must be an integer from 1 to 20.' },
      { field: 'maxUrls', message: 'maxUrls must be a positive integer.' },
    ]);
  });

  it('rejects values that would be unsafe in pipeline output paths', () => {
    const result = validatePipelineRequest({
      city: '..\\Salem',
      state: 'OR',
      category: 'FOOD/BANK',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toEqual([
      {
        field: 'city',
        message:
          'city must not contain path separators, control characters, or filename-reserved characters.',
      },
      { field: 'city', message: 'city must not contain "..".' },
      {
        field: 'category',
        message:
          'category must not contain path separators, control characters, or filename-reserved characters.',
      },
      {
        field: 'category',
        message: 'category must use UPPER_SNAKE_CASE letters, numbers, and underscores.',
      },
    ]);
  });
});
