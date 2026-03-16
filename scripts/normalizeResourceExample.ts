import { normalizeResourceCollection } from "../src/normalizers/resourceNormalizer.ts";

const rawApiItems = [
  {
    id: "loc_123",
    organizationName: " Downtown Community Pantry ",
    aliases: ["DCP", "Downtown Pantry", "DCP"],
    details: " Walk-in food pantry.\n Open to residents of the county. ",
    services: ["food pantry", "emergency food; groceries"],
    taxonomy: ["Food", "Basic Needs"],
    spokenLanguages: ["English", "Spanish", null],
    requirements: "Photo ID | Proof of address",
    phoneNumber: "(503) 555-0101 ext 9",
    emailAddress: "HELP@PANTRY.ORG ",
    website: "pantry.org/help",
    address: {
      street1: " 123 Main St. ",
      line2: "Suite 200",
      city: "Portland",
      state: "OR",
      postalCode: "97204",
      latitude: "45.5231",
      longitude: "-122.6765",
    },
    openingHours: ["Mon-Fri: 9am - 5pm ", " Sat: 10am - 2pm"],
    url: "https://example.org/resources/loc_123",
    updatedAt: "2026-03-01T12:00:00-08:00",
  },
  {
    _id: "loc_456",
    title: "Family Support Center",
    summary: "Housing navigation and benefit enrollment assistance",
    serviceType: "housing navigation, benefits enrollment",
    categories: ["Housing", "Benefits"],
    language: "English; Vietnamese",
    eligibility: ["Families with children", "Low income"],
    telephone: "1-971-555-0199",
    contact: {
      email: "info@familysupport.org",
      website: "https://familysupport.org",
    },
    street: "456 Oak Ave",
    city: "Salem",
    region: "OR",
    zip: "97301",
    lat: 44.9429,
    lng: -123.0351,
    monday: "8:30 AM - 4:30 PM",
    tuesday: "8:30 AM - 4:30 PM",
    scheduleNotes: "Call ahead for intake appointment.",
  },
];

const normalized = normalizeResourceCollection(rawApiItems, {
  sourceSystem: "example-directory-api",
});

console.log("Sample input:");
console.log(JSON.stringify(rawApiItems[0], null, 2));
console.log("\nNormalized output:");
console.log(JSON.stringify(normalized[0], null, 2));
