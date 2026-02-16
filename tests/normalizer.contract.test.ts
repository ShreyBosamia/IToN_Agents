import { describe, it, expect } from "vitest";
import { normalizeWhitespace, dedupeStrings } from "../src/normalizers/pipelineUtils";

describe("Normalizer Contract Tests (pipeline utilities)", () => {
  it("normalizeWhitespace trims and collapses whitespace", () => {
    expect(normalizeWhitespace("  hello   world \n")).toBe("hello world");
  });

  it("dedupeStrings removes duplicates after whitespace normalization and drops empty", () => {
    const input = ["  Monday: 9-5  ", "Monday: 9-5", "", "   ", "Tuesday: 9-5"];
    const out = dedupeStrings(input);
    expect(out).toEqual(["Monday: 9-5", "Tuesday: 9-5"]);
  });

  it("dedupeStrings preserves first-seen order", () => {
    const input = ["A", "B", "A", "C", "B"];
    expect(dedupeStrings(input)).toEqual(["A", "B", "C"]);
  });
});
