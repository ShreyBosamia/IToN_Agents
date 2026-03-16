import { NormalizedResourceSchema, type NormalizedResource } from "../schemas/resource.schema.ts";

type AnyRecord = Record<string, unknown>;

export type FieldCandidate = string | string[];

export interface ResourceNormalizerOptions {
  sourceSystem: string;
  fieldMap?: Partial<Record<keyof NormalizedResource, FieldCandidate[]>>;
}

const DEFAULT_FIELD_MAP: Partial<Record<keyof NormalizedResource, FieldCandidate[]>> = {
  sourceRecordId: [["id"], ["_id"], ["uuid"], ["recordId"], ["locationId"]],
  name: [["name"], ["title"], ["locationName"], ["organizationName"], ["agencyName"]],
  alternateNames: [["alternateNames"], ["aliases"], ["aka"]],
  description: [["description"], ["summary"], ["details"], ["notes"]],
  serviceTypes: [["serviceTypes"], ["serviceType"], ["services"], ["programs"]],
  categories: [["categories"], ["category"], ["taxonomy"]],
  tags: [["tags"], ["keywords"]],
  languages: [["languages"], ["language"], ["spokenLanguages"]],
  eligibility: [["eligibility"], ["requirements"]],
  address: [["address"], ["location"], ["contact"]],
  location: [["coordinates"], ["geo"], ["location"]],
  contact: [["contact"], ["contacts"]],
  hours: [["hours"], ["openingHours"], ["schedule"], ["hoursOfOperation"]],
  rawMeta: [["url"], ["website"], ["lastUpdated"], ["updatedAt"]],
};

export function normalizeResourceRecord(
  raw: unknown,
  options: ResourceNormalizerOptions
): NormalizedResource {
  const record = asRecord(raw);
  const fieldMap = { ...DEFAULT_FIELD_MAP, ...options.fieldMap };

  const name =
    firstNonEmptyString(record, fieldMap.name) ||
    firstNonEmptyString(record, [["providerName"], ["siteName"]]) ||
    "Unknown resource";

  const phones = dedupeStrings(
    toStringArray(resolveCandidate(record, [["phone"], ["phoneNumber"], ["telephone"], ["contact", "phone"]])).map(
      normalizePhoneNumber
    )
  );

  const emails = dedupeStrings(
    toStringArray(resolveCandidate(record, [["email"], ["emailAddress"], ["contact", "email"]])).map(
      normalizeEmail
    )
  );

  const addressRecord = firstRecord(
    resolveCandidate(record, [["address"]]),
    resolveCandidate(record, [["location"]]),
    record
  );

  const address = normalizeAddress(addressRecord);
  const location = normalizeLocation(record, addressRecord);
  const hours = normalizeHours(resolveCandidate(record, fieldMap.hours), record);

  const normalized: NormalizedResource = {
    sourceSystem: cleanString(options.sourceSystem) || "unknown",
    sourceRecordId: nullIfEmpty(
      firstNonEmptyString(record, fieldMap.sourceRecordId) ||
        firstNonEmptyString(record, [["slug"], ["externalId"]])
    ),
    name,
    alternateNames: dedupeStrings(
      toStringArray(resolveCandidate(record, fieldMap.alternateNames)).filter((value) => value !== name)
    ),
    description: nullIfEmpty(
      cleanParagraphs(
        firstNonEmptyString(record, fieldMap.description) ||
          toStringArray(resolveCandidate(record, [["descriptionBlocks"]])).join("\n")
      )
    ),
    serviceTypes: dedupeStrings(
      toStringArray(resolveCandidate(record, fieldMap.serviceTypes)).flatMap(splitMultiValueField)
    ),
    categories: dedupeStrings(
      toStringArray(resolveCandidate(record, fieldMap.categories)).flatMap(splitMultiValueField)
    ),
    tags: dedupeStrings(toStringArray(resolveCandidate(record, fieldMap.tags)).flatMap(splitMultiValueField)),
    languages: dedupeStrings(
      toStringArray(resolveCandidate(record, fieldMap.languages)).flatMap(splitMultiValueField)
    ),
    eligibility: dedupeStrings(
      toStringArray(resolveCandidate(record, fieldMap.eligibility)).flatMap(splitMultiValueField)
    ),
    address,
    location,
    contact: {
      phones: phones.filter(Boolean),
      emails: emails.filter(Boolean),
      website: normalizeUrl(
        firstNonEmptyString(record, [["website"], ["url"], ["link"], ["contact", "website"]])
      ),
    },
    hours,
    rawMeta: {
      recordUrl: normalizeUrl(firstNonEmptyString(record, [["recordUrl"], ["url"], ["website"]])),
      lastUpdated: normalizeIsoDate(
        firstNonEmptyString(record, [["lastUpdated"], ["updatedAt"], ["modifiedAt"]])
      ),
    },
  };

  return NormalizedResourceSchema.parse(normalized);
}

export function normalizeResourceCollection(
  rawItems: unknown[],
  options: ResourceNormalizerOptions
): NormalizedResource[] {
  return rawItems.map((item) => normalizeResourceRecord(item, options));
}

export function cleanString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function nullIfEmpty(value: unknown): string | null {
  const cleaned = cleanString(value);
  return cleaned ? cleaned : null;
}

export function toStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => toStringArray(item))
      .map(cleanString)
      .filter(Boolean);
  }
  if (typeof value === "object") {
    const record = value as AnyRecord;
    const directValue = [record.name, record.label, record.value, record.text]
      .map(cleanString)
      .find(Boolean);
    return directValue ? [directValue] : [];
  }
  return [cleanString(value)].filter(Boolean);
}

export function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values.map(cleanString).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

export function normalizePhoneNumber(value: unknown): string {
  const text = cleanString(value);
  if (!text) return "";

  const extensionMatch = text.match(/(?:ext\.?|x)\s*(\d+)$/i);
  const extension = extensionMatch?.[1];
  const withoutExtension = extension ? text.replace(/(?:ext\.?|x)\s*\d+$/i, "").trim() : text;
  const digits = withoutExtension.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    const local = digits.slice(1);
    return formatNorthAmericanPhone(local, extension);
  }

  if (digits.length === 10) {
    return formatNorthAmericanPhone(digits, extension);
  }

  return text;
}

export function normalizeEmail(value: unknown): string {
  return cleanString(value).toLowerCase();
}

export function normalizeUrl(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;

  try {
    return new URL(withProtocol).toString();
  } catch {
    return null;
  }
}

export function cleanParagraphs(value: unknown): string {
  return cleanString(value).replace(/\s*\n\s*/g, "\n");
}

export function normalizeAddress(value: unknown): NormalizedResource["address"] {
  const record = asRecord(value);
  const fullAddress =
    nullIfEmpty(firstNonEmptyString(record, [["fullAddress"], ["address"], ["formatted_address"]])) ||
    buildFullAddress({
      address1: firstNonEmptyString(record, [["address1"], ["street"], ["street1"], ["line1"]]),
      address2: firstNonEmptyString(record, [["address2"], ["street2"], ["line2"], ["unit"]]),
      city: firstNonEmptyString(record, [["city"], ["locality"]]),
      region: firstNonEmptyString(record, [["state"], ["province"], ["region"]]),
      postalCode: firstNonEmptyString(record, [["zip"], ["zipCode"], ["postalCode"]]),
      country: firstNonEmptyString(record, [["country"]]),
    });

  return {
    fullAddress,
    address1: nullIfEmpty(firstNonEmptyString(record, [["address1"], ["street"], ["street1"], ["line1"]])),
    address2: nullIfEmpty(firstNonEmptyString(record, [["address2"], ["street2"], ["line2"], ["unit"]])),
    city: nullIfEmpty(firstNonEmptyString(record, [["city"], ["locality"]])),
    region: nullIfEmpty(firstNonEmptyString(record, [["state"], ["province"], ["region"]])),
    postalCode: nullIfEmpty(firstNonEmptyString(record, [["zip"], ["zipCode"], ["postalCode"]])),
    country: nullIfEmpty(firstNonEmptyString(record, [["country"]])),
  };
}

function normalizeLocation(
  root: AnyRecord,
  addressRecord: AnyRecord
): NormalizedResource["location"] {
  return {
    latitude: firstNumber(
      resolveCandidate(root, [["latitude"], ["lat"], ["coordinates", "lat"], ["location", "lat"]]),
      resolveCandidate(addressRecord, [["latitude"], ["lat"]])
    ),
    longitude: firstNumber(
      resolveCandidate(root, [["longitude"], ["lng"], ["lon"], ["coordinates", "lng"], ["location", "lng"]]),
      resolveCandidate(addressRecord, [["longitude"], ["lng"], ["lon"]])
    ),
  };
}

function normalizeHours(value: unknown, root: AnyRecord): NormalizedResource["hours"] {
  const weekdayText = dedupeStrings([
    ...toStringArray(value).flatMap(splitMultiValueField),
    ...[
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]
      .map((day) => {
        const text = cleanString(root[day]);
        return text ? `${capitalize(day)}: ${text}` : "";
      })
      .filter(Boolean),
  ]);

  return {
    weekdayText,
    notes: nullIfEmpty(firstNonEmptyString(root, [["hoursNotes"], ["scheduleNotes"]])),
  };
}

function splitMultiValueField(value: string): string[] {
  return value
    .split(/[|;,]/g)
    .map(cleanString)
    .filter(Boolean);
}

function resolveCandidate(record: AnyRecord, candidates?: FieldCandidate[]): unknown {
  if (!candidates) return undefined;

  for (const candidate of candidates) {
    const path = Array.isArray(candidate) ? candidate : [candidate];
    const resolved = getPath(record, path);
    if (hasValue(resolved)) return resolved;
  }

  return undefined;
}

function firstNonEmptyString(record: AnyRecord, candidates?: FieldCandidate[]): string {
  return toStringArray(resolveCandidate(record, candidates))[0] ?? "";
}

function getPath(record: AnyRecord, path: string[]): unknown {
  let current: unknown = record;

  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as AnyRecord)[segment];
  }

  return current;
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return cleanString(value).length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as AnyRecord).length > 0;
  return true;
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function firstRecord(...values: unknown[]): AnyRecord {
  return asRecord(values.find((value) => value && typeof value === "object" && !Array.isArray(value)));
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numberValue = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

function buildFullAddress(parts: {
  address1?: string;
  address2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}): string | null {
  const line1 = [parts.address1, parts.address2].map(cleanString).filter(Boolean).join(" ");
  const line2 = [parts.city, parts.region, parts.postalCode].map(cleanString).filter(Boolean).join(", ");
  const full = [line1, line2, cleanString(parts.country)].filter(Boolean).join(", ");
  return full || null;
}

function normalizeIsoDate(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatNorthAmericanPhone(digits: string, extension?: string): string {
  const base = `+1 ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return extension ? `${base} x${extension}` : base;
}
