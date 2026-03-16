import { normalizePhoneNumber, normalizeUrl } from "./resourceNormalizer.ts";
import { NormalizedResourceSchema, type NormalizedResource } from "../schemas/resource.schema.ts";

type AnyRecord = Record<string, unknown>;

interface ProviderOutputAdapterOptions {
  sourceSystem: string;
}

export function normalizeProviderOutputRecord(
  raw: unknown,
  options: ProviderOutputAdapterOptions
): NormalizedResource {
  const record = asRecord(raw);
  const location = asRecord(record.location);
  const contact = asRecord(record.contact);
  const hoursOfOperation = asRecord(record.hoursOfOperation);
  const serviceTypes = Array.isArray(record.serviceTypes)
    ? record.serviceTypes
        .map((item) => asRecord(item)._id)
        .map(cleanString)
        .filter(Boolean)
    : [];

  const normalized: NormalizedResource = {
    sourceSystem: cleanString(options.sourceSystem) || "provider-output",
    sourceRecordId: null,
    name: cleanString(record.name) || "Unknown resource",
    alternateNames: [],
    description: nullIfEmpty(extractPortableText(record.description)),
    serviceTypes,
    categories: [],
    tags: [],
    languages: [],
    eligibility: [],
    address: {
      fullAddress: nullIfEmpty(record.address),
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
      country: null,
    },
    location: {
      latitude: toNumber(location.latitude),
      longitude: toNumber(location.longitude),
    },
    contact: {
      phones: [normalizePhoneNumber(contact.phone)].filter(Boolean),
      emails: [cleanString(contact.email).toLowerCase()].filter(Boolean),
      website: normalizeUrl(contact.website),
    },
    hours: {
      weekdayText: Array.isArray(hoursOfOperation.weekdayText)
        ? hoursOfOperation.weekdayText.map(cleanString).filter(Boolean)
        : [],
      notes: null,
    },
    rawMeta: {
      recordUrl: null,
      lastUpdated: null,
    },
  };

  return NormalizedResourceSchema.parse(normalized);
}

export function normalizeProviderOutputCollection(
  records: unknown[],
  options: ProviderOutputAdapterOptions
): NormalizedResource[] {
  return records.map((record) => normalizeProviderOutputRecord(record, options));
}

function extractPortableText(value: unknown): string {
  if (!Array.isArray(value)) return "";

  return value
    .map((block) => {
      const record = asRecord(block);
      const children = Array.isArray(record.children) ? record.children : [];
      return children
        .map((child) => cleanString(asRecord(child).text))
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function cleanString(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nullIfEmpty(value: unknown): string | null {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function toNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
