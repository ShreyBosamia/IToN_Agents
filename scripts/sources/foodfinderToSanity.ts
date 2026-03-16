import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { normalizeProviderOutputCollection } from "../../src/normalizers/providerOutputAdapter.ts";

/**
 * FoodFinder API types (minimal)
 */
type FoodFinderHour = {
  day?: number; // 0-6
  days?: number[]; // grouped_location_hours
  open_time: string; // "2026-02-17T13:00"
  close_time: string; // "2026-02-17T14:00"
};

type FoodFinderLocation = {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone?: string; 
  website?: unknown[]; 
  location_hours?: FoodFinderHour[];
  grouped_location_hours?: FoodFinderHour[];
  location_categories?: Array<{
    description?: Record<string, string>;
    label?: Record<string, string>;
  }>;
};

type FoodFinderResponse = {
  locations: FoodFinderLocation[];
};

/**
 * Sanity-ish output type (matches your ProviderSchema shape)
 */
type SanityBlock = {
  _type: "block";
  children: Array<{ _type: "span"; text: string }>;
  markDefs: unknown[];
  style: string;
};

type ProviderDoc = {
  name: string;
  description: SanityBlock[];
  address: string | null;
  location: { latitude: number | null; longitude: number | null };
  serviceTypes: Array<{ _id: string }>;
  hoursOfOperation?: {
    periods: any[] | null;
    weekdayText: string[] | null;
  } | null;
  contact: {
    phone: string | null;
    email: string | null;
    website: string | null;
  };
};

function normalizeWhitespace(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeToHHMM(t: string): string {
  const m = String(t).match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

function buildWeekdayText(loc: FoodFinderLocation): string[] | null {
  const hours = (loc.location_hours?.length ? loc.location_hours : loc.grouped_location_hours) ?? [];
  if (!hours.length) return null;

  const lines: string[] = [];

  for (const h of hours) {
    const open = timeToHHMM(h.open_time);
    const close = timeToHHMM(h.close_time);
    if (!open || !close) continue;

    const days =
      Array.isArray(h.days) && h.days.length
        ? h.days
        : typeof h.day === "number"
          ? [h.day]
          : [];

    for (const d of days) {
      const dayName = DAY_NAMES[d] ?? `Day${d}`;
      lines.push(`${dayName}: ${open} - ${close}`);
    }
  }

  // dedupe, keep order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines.map(normalizeWhitespace).filter(Boolean)) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out.length ? out : null;
}

function pickDescriptionEn(loc: FoodFinderLocation): string {
  const en =
    loc.location_categories?.[0]?.description?.en ||
    loc.location_categories?.[0]?.label?.en ||
    "";
  return normalizeWhitespace(en) || "Food Finder provider";
}

function foodFinderLocationToProvider(loc: FoodFinderLocation, categoryId: string): ProviderDoc {
  const phone = normalizeWhitespace(loc.phone ?? "");
  const websiteArr = Array.isArray(loc.website) ? loc.website : [];
  const website = typeof websiteArr[0] === "string" ? normalizeWhitespace(websiteArr[0]) : "";

  const weekdayText = buildWeekdayText(loc);

  return {
    name: normalizeWhitespace(loc.name) || normalizeWhitespace(loc.id) || "Unknown provider",
    description: [
      {
        _type: "block",
        children: [{ _type: "span", text: pickDescriptionEn(loc) }],
        markDefs: [],
        style: "normal",
      },
    ],
    address: normalizeWhitespace(loc.address) || null,
    location: {
      latitude: loc.latitude ?? null,
      longitude: loc.longitude ?? null,
    },
    serviceTypes: [{ _id: categoryId }],
    hoursOfOperation: {
      periods: null, 
      weekdayText: weekdayText, 
    },
    contact: {
      phone: phone ? phone : null,
      email: null,
      website: website ? website : null,
    },
  };
}

async function main() {
  const [categoryId, limitArg] = process.argv.slice(2);
  if (!categoryId) {
    console.error("Usage: tsx scripts/foodfinderToSanity.ts <categoryId> [limit]");
    process.exit(1);
  }
  const limit = limitArg ? Number.parseInt(limitArg, 10) : 10;

  const url = "https://foodfinder.oregonfoodbank.org/api/v1/locations";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FoodFinder API failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as FoodFinderResponse;
  const locations = Array.isArray(data.locations) ? data.locations : [];

  const picked = locations.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 10);
  const sanityDocs = picked.map((loc) => foodFinderLocationToProvider(loc, categoryId));

  const outDir = path.resolve(process.cwd(), "outputs");
  await mkdir(outDir, { recursive: true });

  const outFile = path.join(outDir, `foodfinder_${categoryId}_sanity.json`);
  await writeFile(outFile, JSON.stringify(sanityDocs, null, 2), "utf-8");

  const normalized = normalizeProviderOutputCollection(sanityDocs, {
    sourceSystem: "foodfinder",
  });
  const normalizedOutFile = path.join(outDir, `foodfinder_${categoryId}_normalized.json`);
  await writeFile(normalizedOutFile, JSON.stringify(normalized, null, 2), "utf-8");

  console.log(`Fetched locations: ${locations.length}`);
  console.log(`Wrote: ${outFile}`);
  console.log(`Wrote: ${normalizedOutFile}`);
  console.log(`Sample:`, sanityDocs[0]);
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
