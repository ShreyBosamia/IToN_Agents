import { describe, expect, it } from "vitest";

import { normalizeProviderOutputRecord } from "../src/normalizers/providerOutputAdapter.ts";

describe("providerOutputAdapter", () => {
  it("converts generic provider-style output into the shared normalized schema", () => {
    const normalized = normalizeProviderOutputRecord(
      {
        name: "Example Pantry",
        description: [
          {
            _type: "block",
            children: [{ _type: "span", text: "Example provider description" }],
            markDefs: [],
            style: "normal",
          },
        ],
        address: "100 Main St, Portland, OR 97204",
        location: {
          latitude: 45.52,
          longitude: -122.67,
        },
        serviceTypes: [{ _id: "food-pantry" }],
        hoursOfOperation: {
          periods: null,
          weekdayText: ["Monday: 09:00 - 17:00"],
        },
        contact: {
          phone: "(503) 555-0101",
          email: "Info@example.org",
          website: "example.org",
        },
      },
      { sourceSystem: "provider-test" }
    );

    expect(normalized.sourceSystem).toBe("provider-test");
    expect(normalized.description).toBe("Example provider description");
    expect(normalized.serviceTypes).toEqual(["food-pantry"]);
    expect(normalized.contact.phones).toEqual(["+1 503-555-0101"]);
    expect(normalized.contact.emails).toEqual(["info@example.org"]);
    expect(normalized.contact.website).toBe("https://example.org/");
    expect(normalized.hours.weekdayText).toEqual(["Monday: 09:00 - 17:00"]);
  });
});
