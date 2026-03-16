import { describe, expect, it } from "vitest";

import {
  normalizePhoneNumber,
  normalizeResourceRecord,
  normalizeUrl,
} from "../src/normalizers/resourceNormalizer.ts";

describe("resourceNormalizer", () => {
  it("normalizes inconsistent records into the shared schema", () => {
    const normalized = normalizeResourceRecord(
      {
        id: "abc-123",
        organizationName: " Resource Center ",
        aliases: ["RC", "Resource Center"],
        details: " Food pantry and case management ",
        services: ["food pantry; case management"],
        taxonomy: ["Food", "Support Services"],
        spokenLanguages: ["English", "Spanish"],
        requirements: ["ID", " Proof of residence "],
        phoneNumber: "(503) 555-0101",
        emailAddress: "INFO@Resource.org ",
        website: "resource.org",
        address: {
          street1: "100 Main St",
          city: "Portland",
          state: "OR",
          postalCode: "97204",
        },
        latitude: "45.52",
        longitude: "-122.67",
        openingHours: ["Mon-Fri: 9am-5pm"],
      },
      { sourceSystem: "test-api" }
    );

    expect(normalized.name).toBe("Resource Center");
    expect(normalized.alternateNames).toEqual(["RC"]);
    expect(normalized.serviceTypes).toEqual(["food pantry", "case management"]);
    expect(normalized.contact.phones).toEqual(["+1 503-555-0101"]);
    expect(normalized.contact.emails).toEqual(["info@resource.org"]);
    expect(normalized.contact.website).toBe("https://resource.org/");
    expect(normalized.address.fullAddress).toContain("100 Main St");
    expect(normalized.location.latitude).toBe(45.52);
    expect(normalized.hours.weekdayText).toEqual(["Mon-Fri: 9am-5pm"]);
  });

  it("normalizes North American phone numbers and preserves extensions", () => {
    expect(normalizePhoneNumber("503.555.0101 x22")).toBe("+1 503-555-0101 x22");
  });

  it("returns null for invalid URLs", () => {
    expect(normalizeUrl("not a url")).toBeNull();
  });
});
