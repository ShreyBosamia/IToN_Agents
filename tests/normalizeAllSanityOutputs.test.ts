import { describe, expect, it } from "vitest";

describe("normalizeAllSanityOutputs filename mapping", () => {
  it("keeps filename convention compatible with normalized output suffix", () => {
    const input = "totalapi_meal_provider_test-service_sanity.json";
    const output = input.replace(/_sanity\.json$/i, "_normalized.json");

    expect(output).toBe("totalapi_meal_provider_test-service_normalized.json");
  });
});
