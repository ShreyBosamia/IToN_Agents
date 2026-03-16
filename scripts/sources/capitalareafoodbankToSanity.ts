console.log("SCRIPT STARTED");

import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import { normalizeProviderOutputCollection } from "../../src/normalizers/providerOutputAdapter.ts";

type ArcGisFeature = {
  attributes: Record<string, any>;
  geometry?: { x?: number; y?: number };
};

type ArcGisResponse = {
  features?: ArcGisFeature[];
  exceededTransferLimit?: boolean;
};

function normalizeWhitespace(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function buildAddress(a: Record<string, any>): string | null {
  const line1 = normalizeWhitespace(a.Address_1 ?? "");
  const line2 = normalizeWhitespace(a.Address_2 ?? "");
  const city = normalizeWhitespace(a.City ?? "");
  const state = normalizeWhitespace(a.State ?? "");
  const zip = normalizeWhitespace(a.Zip ?? "");

  const street = [line1, line2].filter(Boolean).join(" ");
  const cityLine = [city, state].filter(Boolean).join(", ");
  const full = [street, cityLine, zip].filter(Boolean).join(" ");

  return full ? full : null;
}

function pickName(a: Record<string, any>): string {
  return (
    normalizeWhitespace(a.Agency_Name_1) ||
    normalizeWhitespace(a.Agency_Ref_1) ||
    "Unknown provider"
  );
}

function pickDescription(a: Record<string, any>): string {
  const cat = normalizeWhitespace(a.Category ?? "");
  const code1 = normalizeWhitespace(a.Code1 ?? "");
  const direct = normalizeWhitespace(a.Direct_Distributions ?? "");
  const senior = normalizeWhitespace(a.Senior_Hunger ?? "");

  const bits = [cat, code1, direct, senior].filter(Boolean);
  return bits.length ? `ArcGIS agency data (${bits.join(" / ")})` : "ArcGIS agency data";
}

function getLatLng(a: Record<string, any>): { latitude: number | null; longitude: number | null } {
  const lat = typeof a.Latitude === "number" ? a.Latitude : null;
  const lng = typeof a.Longitude === "number" ? a.Longitude : null;
  if (lat !== null && lng !== null) return { latitude: lat, longitude: lng };

  const geo = normalizeWhitespace(a.Geocoordinates ?? "");
  const m = geo.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return { latitude: lat, longitude: lng };
  return { latitude: Number(m[1]), longitude: Number(m[2]) };
}

function arcgisFeatureToProvider(f: ArcGisFeature, serviceTypeId: string) {
  const a = f.attributes ?? {};
  const { latitude, longitude } = getLatLng(a);

  return {
    name: pickName(a),
    description: [
      {
        _type: "block",
        children: [{ _type: "span", text: pickDescription(a) }],
        markDefs: [],
        style: "normal",
      },
    ],
    address: buildAddress(a),
    location: {
      latitude,
      longitude,
    },
    serviceTypes: [{ _id: serviceTypeId }],

    hoursOfOperation: {
      periods: null,
      weekdayText: null,
    },

    contact: {
      phone: null,
      email: null,
      website: null,
    },

  };
}

async function main() {
  const serviceTypeId = process.argv[2];
  const limitArg = process.argv[3];

  if (!serviceTypeId) {
    console.error('Usage: npx tsx scripts/arcgisToSanity.ts "<serviceTypeId>" <limit?>');
    process.exit(1);
  }

  const limit = limitArg ? Number(limitArg) : undefined;
  if (limitArg && Number.isNaN(limit)) {
    console.error("limit must be a number");
    process.exit(1);
  }

  const url =
    "https://services.arcgis.com/oCjyzxNy34f0pJCV/arcgis/rest/services/FY25_Master_Agency_File_HHM_7_30_25/FeatureServer/0/query" +
    "?where=1%3D1" +
    "&outFields=*" +
    "&returnGeometry=false" + 
    "&f=pjson";

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ArcGIS request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as ArcGisResponse;
  const features = Array.isArray(data.features) ? data.features : [];

  console.log(`Fetched features: ${features.length}`);
  if (data.exceededTransferLimit) {
    console.warn("Warning: exceededTransferLimit=true (need pagination via resultOffset/resultRecordCount)");
  }

  const sliced = typeof limit === "number" ? features.slice(0, limit) : features;

  const providers = sliced.map((f) => arcgisFeatureToProvider(f, serviceTypeId));

  const outDir = path.join(process.cwd(), "outputs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `arcgis_${serviceTypeId}_sanity.json`);
  fs.writeFileSync(outPath, JSON.stringify(providers, null, 2), "utf-8");

  const normalized = normalizeProviderOutputCollection(providers, {
    sourceSystem: "capitalareafoodbank-arcgis",
  });
  const normalizedOutPath = path.join(outDir, `arcgis_${serviceTypeId}_normalized.json`);
  fs.writeFileSync(normalizedOutPath, JSON.stringify(normalized, null, 2), "utf-8");

  console.log(`Wrote: ${outPath}`);
  console.log(`Wrote: ${normalizedOutPath}`);
  console.log("Sample:", providers[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
