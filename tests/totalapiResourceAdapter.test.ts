import { describe, expect, it } from "vitest";

import { normalizeTotalApiProviderRecord } from "../src/normalizers/totalapiResourceAdapter.ts";

describe("totalapiResourceAdapter", () => {
  it("converts totalapi provider output into the shared normalized schema", () => {
    const normalized = normalizeTotalApiProviderRecord({
      name: "Cozad Haymaker Grand Generation Center",
      description: [
        {
          _type: "block",
          children: [{ _type: "span", text: "Storepoint directory data" }],
          markDefs: [],
          style: "normal",
        },
      ],
      address: "410 W 9th St, Cozad, NE 69130",
      location: {
        latitude: 40.860861,
        longitude: -99.990451,
      },
      serviceTypes: [{ _id: "meal-provider" }],
      hoursOfOperation: {
        periods: null,
        weekdayText: null,
      },
      contact: {
        phone: "(308) 784-2747",
        email: null,
        website: null,
      },
    });

    expect(normalized.sourceSystem).toBe("totalapi");
    expect(normalized.name).toBe("Cozad Haymaker Grand Generation Center");
    expect(normalized.description).toBe("Storepoint directory data");
    expect(normalized.address.fullAddress).toBe("410 W 9th St, Cozad, NE 69130");
    expect(normalized.location.latitude).toBe(40.860861);
    expect(normalized.serviceTypes).toEqual(["meal-provider"]);
    expect(normalized.contact.phones).toEqual(["+1 308-784-2747"]);
    expect(normalized.hours.weekdayText).toEqual([]);
  });
});
