import { type NormalizedResource } from "../schemas/resource.schema.ts";
import { normalizeProviderOutputCollection, normalizeProviderOutputRecord } from "./providerOutputAdapter.ts";

export function normalizeTotalApiProviderRecord(
  raw: unknown,
  options?: { sourceSystem?: string }
): NormalizedResource {
  return normalizeProviderOutputRecord(raw, {
    sourceSystem: options?.sourceSystem ?? "totalapi",
  });
}

export function normalizeTotalApiProviderCollection(
  records: unknown[],
  options?: { sourceSystem?: string }
): NormalizedResource[] {
  return normalizeProviderOutputCollection(records, {
    sourceSystem: options?.sourceSystem ?? "totalapi",
  });
}
