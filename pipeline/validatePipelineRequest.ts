export type PipelineInput = {
  city: string;
  state: string;
  category: string;
  perQuery?: number;
  maxUrls?: number;
};

export type PipelineValidationError = {
  field: string;
  message: string;
};

export type PipelineValidationResult =
  | { ok: true; value: PipelineInput }
  | { ok: false; errors: PipelineValidationError[] };

const ALLOWED_FIELDS = ['city', 'state', 'category', 'perQuery', 'maxUrls'] as const;
const ALLOWED_FIELD_SET = new Set<string>(ALLOWED_FIELDS);
const MAX_CITY_LENGTH = 80;
const MAX_STATE_LENGTH = 80;
const MAX_CATEGORY_LENGTH = 64;
const MAX_PER_QUERY = 20;
const FILENAME_RESERVED_CHARS = /[<>:"/\\|?*]/;
const CATEGORY_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32);
}

function validateRequiredString(
  body: Record<string, unknown>,
  field: 'city' | 'state' | 'category',
  maxLength: number,
  errors: PipelineValidationError[]
): string | undefined {
  const value = body[field];

  if (value == null) {
    errors.push({ field, message: `${field} is required.` });
    return undefined;
  }

  if (typeof value !== 'string') {
    errors.push({ field, message: `${field} must be a string.` });
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    errors.push({ field, message: `${field} is required.` });
    return undefined;
  }

  if (trimmed.length > maxLength) {
    errors.push({ field, message: `${field} must be ${maxLength} characters or fewer.` });
  }

  if (FILENAME_RESERVED_CHARS.test(trimmed) || hasControlCharacter(trimmed)) {
    errors.push({
      field,
      message: `${field} must not contain path separators, control characters, or filename-reserved characters.`,
    });
  }

  if (trimmed.includes('..')) {
    errors.push({ field, message: `${field} must not contain "..".` });
  }

  return trimmed;
}

function validateCategory(category: string | undefined, errors: PipelineValidationError[]): void {
  if (!category) return;

  if (!CATEGORY_PATTERN.test(category)) {
    errors.push({
      field: 'category',
      message: 'category must use UPPER_SNAKE_CASE letters, numbers, and underscores.',
    });
  }
}

function validateOptionalInteger(
  body: Record<string, unknown>,
  field: 'perQuery' | 'maxUrls',
  errors: PipelineValidationError[]
): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, field)) return undefined;

  const value = body[field];
  const max = field === 'perQuery' ? MAX_PER_QUERY : Number.MAX_SAFE_INTEGER;
  const rangeMessage =
    field === 'perQuery'
      ? `perQuery must be an integer from 1 to ${MAX_PER_QUERY}.`
      : 'maxUrls must be a positive integer.';

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    errors.push({ field, message: rangeMessage });
    return undefined;
  }

  return value;
}

export function formatPipelineValidationError(errors: PipelineValidationError[]) {
  return {
    error: 'Invalid pipeline request.',
    errors,
  };
}

export function validatePipelineRequest(body: unknown): PipelineValidationResult {
  const errors: PipelineValidationError[] = [];

  if (!isRecord(body)) {
    return {
      ok: false,
      errors: [{ field: 'body', message: 'request body must be a JSON object.' }],
    };
  }

  for (const field of Object.keys(body)) {
    if (!ALLOWED_FIELD_SET.has(field)) {
      errors.push({
        field,
        message: `Unknown field "${field}". Allowed fields: ${ALLOWED_FIELDS.join(', ')}.`,
      });
    }
  }

  const city = validateRequiredString(body, 'city', MAX_CITY_LENGTH, errors);
  const state = validateRequiredString(body, 'state', MAX_STATE_LENGTH, errors);
  const category = validateRequiredString(body, 'category', MAX_CATEGORY_LENGTH, errors);
  validateCategory(category, errors);

  const perQuery = validateOptionalInteger(body, 'perQuery', errors);
  const maxUrls = validateOptionalInteger(body, 'maxUrls', errors);

  if (errors.length > 0 || !city || !state || !category) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      city,
      state,
      category,
      ...(perQuery === undefined ? {} : { perQuery }),
      ...(maxUrls === undefined ? {} : { maxUrls }),
    },
  };
}
