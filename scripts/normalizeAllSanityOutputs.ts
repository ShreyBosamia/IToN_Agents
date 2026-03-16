import fs from "node:fs";
import path from "node:path";

import { normalizeProviderOutputCollection } from "../src/normalizers/providerOutputAdapter.ts";

function inferSourceSystem(fileName: string): string {
  const normalized = fileName.toLowerCase();

  if (normalized.startsWith("totalapi_accessfood_")) return "totalapi-accessfood";
  if (normalized.startsWith("totalapi_")) return "totalapi-storepoint";
  if (normalized.startsWith("accessfood_")) return "accessfood";
  if (normalized.startsWith("foodfinder_")) return "foodfinder";
  if (normalized.startsWith("arcgis_")) return "capitalareafoodbank-arcgis";
  if (normalized.startsWith("foodbankoftherookie_")) return "foodbankoftherookie";

  return "provider-output";
}

function normalizeFile(inputPath: string): { outputPath: string; count: number } {
  const rawText = fs.readFileSync(inputPath, "utf-8");
  const payload = JSON.parse(rawText) as unknown;

  if (!Array.isArray(payload)) {
    throw new Error(`Expected an array in ${inputPath}`);
  }

  const fileName = path.basename(inputPath);
  const normalized = normalizeProviderOutputCollection(payload, {
    sourceSystem: inferSourceSystem(fileName),
  });

  const outputPath = inputPath.replace(/_sanity\.json$/i, "_normalized.json");
  fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2), "utf-8");

  return { outputPath, count: normalized.length };
}

async function main() {
  const outputsDir = process.argv[2] ?? path.join(process.cwd(), "outputs");
  const entries = fs
    .readdirSync(outputsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /_sanity\.json$/i.test(name));

  if (!entries.length) {
    console.log(`No *_sanity.json files found in ${outputsDir}`);
    return;
  }

  for (const fileName of entries) {
    const inputPath = path.join(outputsDir, fileName);
    const { outputPath, count } = normalizeFile(inputPath);
    console.log(`Normalized ${fileName} -> ${path.basename(outputPath)} (${count} records)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
