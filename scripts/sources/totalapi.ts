console.log("SCRIPT STARTED (totalapi/storepoint)");

import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";

function normalizeWhitespace(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function pickNumber(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function pickFirstString(...values: unknown[]): string {
  for (const v of values) {
    const s = normalizeWhitespace(v);
    if (s) return s;
  }
  return "";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstArrayFromRecord(rec: Record<string, unknown>): any[] {
  const directKeys = ["locations", "data", "results", "item1", "items"];
  for (const k of directKeys) {
    const v = rec[k];
    if (Array.isArray(v)) return v as any[];
  }

  // Common pattern: payload.results is an object that contains arrays.
  for (const k of directKeys) {
    const v = rec[k];
    if (isRecord(v)) {
      for (const nested of directKeys) {
        const nv = v[nested];
        if (Array.isArray(nv)) return nv as any[];
      }

      // Fallback: first array value inside the nested object.
      for (const val of Object.values(v)) {
        if (Array.isArray(val)) return val as any[];
      }
    }
  }

  // Final fallback: first array value at top-level record.
  for (const val of Object.values(rec)) {
    if (Array.isArray(val)) return val as any[];
  }

  return [];
}

function buildAddressFromParts(parts: {
  address1?: unknown;
  address2?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
}): string | null {
  const line1 = normalizeWhitespace(parts.address1);
  const line2 = normalizeWhitespace(parts.address2);
  const city = normalizeWhitespace(parts.city);
  const state = normalizeWhitespace(parts.state);
  const zip = normalizeWhitespace(parts.zip);

  const street = [line1, line2].filter(Boolean).join(" ");
  const cityLine = [city, state].filter(Boolean).join(", ");
  const full = [street, cityLine, zip].filter(Boolean).join(" ");
  return full || null;
}

function pickAddress(loc: any): string | null {
  const full = pickFirstString(
    loc?.address,
    loc?.Address,
    loc?.full_address,
    loc?.formatted_address,
    loc?.streetaddress
  );
  if (full) return full;
  return buildAddressFromParts({
    address1: loc?.address1 ?? loc?.address_1 ?? loc?.street ?? loc?.street1,
    address2: loc?.address2 ?? loc?.address_2 ?? loc?.street2,
    city: loc?.city,
    state: loc?.state ?? loc?.province,
    zip: loc?.zip ?? loc?.postal_code ?? loc?.postalCode,
  });
}

function pickLatLng(loc: any): { latitude: number | null; longitude: number | null } {
  const latitude =
    pickNumber(loc?.latitude) ??
    pickNumber(loc?.lat) ??
    pickNumber(loc?.loc_lat) ??
    pickNumber(loc?.coords?.lat) ??
    pickNumber(loc?.coordinates?.lat) ??
    null;

  const longitude =
    pickNumber(loc?.longitude) ??
    pickNumber(loc?.lng) ??
    pickNumber(loc?.loc_long) ??
    pickNumber(loc?.coords?.lng) ??
    pickNumber(loc?.coordinates?.lng) ??
    null;

  return { latitude, longitude };
}

function pickWeekdayText(loc: any): string[] | null {
  const raw =
    loc?.hours ??
    loc?.opening_hours ??
    loc?.hours_of_operation ??
    loc?.schedule ??
    loc?.openingHours ??
    null;

  if (!raw) return null;
  if (Array.isArray(raw)) {
    const lines = raw.map((x) => normalizeWhitespace(x)).filter(Boolean);
    return lines.length ? lines : null;
  }
  if (typeof raw === "string") {
    const one = normalizeWhitespace(raw);
    return one ? [one] : null;
  }

  const dayKeys = [
    ["monday", "Monday"],
    ["tuesday", "Tuesday"],
    ["wednesday", "Wednesday"],
    ["thursday", "Thursday"],
    ["friday", "Friday"],
    ["saturday", "Saturday"],
    ["sunday", "Sunday"],
  ] as const;
  const dayLines = dayKeys
    .map(([key, label]) => {
      const v = normalizeWhitespace(loc?.[key]);
      return v ? `${label}: ${v}` : "";
    })
    .filter(Boolean);
  if (dayLines.length) return dayLines;

  return [normalizeWhitespace(JSON.stringify(raw))];
}

function storepointLocationToProvider(loc: any, serviceTypeId: string) {
  const name = pickFirstString(loc?.name, loc?.location_name, loc?.title, loc?.store_name) || "Unknown provider";
  const address = pickAddress(loc);
  const { latitude, longitude } = pickLatLng(loc);
  const weekdayText = pickWeekdayText(loc);

  return {
    name,
    description: [
      {
        _type: "block",
        children: [{ _type: "span", text: "Storepoint directory data" }],
        markDefs: [],
        style: "normal",
      },
    ],
    address,
    location: { latitude, longitude },
    serviceTypes: [{ _id: serviceTypeId }],
    hoursOfOperation: {
      periods: null,
      weekdayText,
    },
    contact: {
      phone: pickFirstString(loc?.phone, loc?.phone_number) || null,
      email: pickFirstString(loc?.email) || null,
      website: pickFirstString(loc?.website, loc?.url, loc?.link) || null,
    },
  };
}

function accessFoodLocationToProvider(loc: any, serviceTypeId: string) {
  const name =
    pickFirstString(loc?.name, loc?.locationName, loc?.organizationName, loc?.agencyName) ||
    "Unknown provider";
  const address = pickAddress(loc);
  const { latitude, longitude } = pickLatLng(loc);

  return {
    name,
    description: [
      {
        _type: "block",
        children: [{ _type: "span", text: "AccessFood directory data" }],
        markDefs: [],
        style: "normal",
      },
    ],
    address,
    location: { latitude, longitude },
    serviceTypes: [{ _id: serviceTypeId }],
    hoursOfOperation: {
      periods: null,
      weekdayText: pickWeekdayText(loc),
    },
    contact: {
      phone: pickFirstString(loc?.phone, loc?.phoneNumber) || null,
      email: pickFirstString(loc?.email) || null,
      website: pickFirstString(loc?.website, loc?.url) || null,
    },
  };
}

async function fetchStorepointLocations(opts: { accountId: string; tag: string }) {
  const url = new URL(`https://api.storepoint.co/v1/${opts.accountId}/locations`);
  url.searchParams.set("rq", "");
  url.searchParams.append("tags[]", opts.tag);

  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Storepoint request failed: ${res.status} ${res.statusText}`);

  const payload: unknown = await res.json();

  let items: any[] = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (isRecord(payload)) {
    items = firstArrayFromRecord(payload);
  }

  if (items[0]) {
    console.log("Storepoint sample keys:", Object.keys(items[0]));
  } else {
    console.log(
      "Storepoint payload shape:",
      Array.isArray(payload) ? "array" : typeof payload,
      isRecord(payload) ? Object.keys(payload) : ""
    );
  }
  return items;
}

async function fetchAccessFoodLocations(locationSearchUrl: string) {
  const res = await fetch(locationSearchUrl, {
    headers: {
      accept: "application/json, text/plain, */*",
      origin: "https://www.foodbankrockies.org",
      referer: "https://www.foodbankrockies.org/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    } as any,
  });
  if (!res.ok) throw new Error(`AccessFood request failed: ${res.status} ${res.statusText}`);

  const payload: any = await res.json();
  const items = Array.isArray(payload?.item1)
    ? payload.item1
    : Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  if (items[0]) {
    console.log("AccessFood sample keys:", Object.keys(items[0]));
  } else {
    console.log(
      "AccessFood payload shape:",
      Array.isArray(payload) ? "array" : typeof payload,
      isRecord(payload) ? Object.keys(payload) : ""
    );
  }
  return items;
}

function dedupeByNameAddress(providers: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const p of providers) {
    const key = `${normalizeWhitespace(p?.name)}||${normalizeWhitespace(p?.address)}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function main() {
  const serviceTypeId = process.argv[2];
  const arg3 = process.argv[3] ?? "meal provider";
  const arg4 = process.argv[4] ?? "161e1dcd91b7b8";
  const accessFoodDefaultUrl =
    "https://api.accessfood.org/api/MapInformation/LocationSearch?radius=20&lat=34.86123422500009&lng=-106.6014092469514&dayAv=&foodProgramAv=&serviceTypeAv=&foodOfferingAv=&dietRestrictionAv=&locationFeatureAv=&languagesAv=&serviceCategoriesAv=&regionId=14&regionMapId=29&showOutOfNetwork=0&page=0&includeLocationOperatingHours=false&isMapV2=true";

  if (!serviceTypeId) {
    console.error(
      'Usage: npx tsx scripts/sources/totalapi.ts "<serviceTypeId>" [tag|accessFoodUrl] [accountId]'
    );
    process.exit(1);
  }

  const isAccessFoodMode = /^https?:\/\//i.test(arg3);
  const sourceName = isAccessFoodMode ? "accessfood" : "storepoint";

  const locations = isAccessFoodMode
    ? await fetchAccessFoodLocations(arg3 || accessFoodDefaultUrl)
    : await fetchStorepointLocations({ accountId: arg4, tag: arg3 });
  console.log(`Total locations fetched (${sourceName}): ${locations.length}`);

  const providers = locations.map((loc: any) =>
    isAccessFoodMode
      ? accessFoodLocationToProvider(loc, serviceTypeId)
      : storepointLocationToProvider(loc, serviceTypeId)
  );
  const deduped = dedupeByNameAddress(providers);
  console.log(`Providers after dedupe(name+address): ${deduped.length}`);

  const outDir = path.join(process.cwd(), "outputs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outputKey = isAccessFoodMode
    ? "accessfood"
    : arg3.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "all";
  const outPath = path.join(outDir, `totalapi_${outputKey}_${serviceTypeId}_sanity.json`);
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2), "utf-8");

  console.log(`Wrote: ${outPath}`);
  console.log("Sample:", deduped[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
