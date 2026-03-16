import fs from "node:fs";
import path from "node:path";

import { normalizeTotalApiProviderCollection } from "../src/normalizers/totalapiResourceAdapter.ts";

async function main() {
  const inputPath =
    process.argv[2] ?? path.join(process.cwd(), "outputs", "totalapi_meal_provider_YOUR_SERVICE_TYPE_ID_sanity.json");
  const sourceSystem = process.argv[3] ?? "totalapi-storepoint";

  const rawText = fs.readFileSync(inputPath, "utf-8");
  const payload = JSON.parse(rawText) as unknown;

  if (!Array.isArray(payload)) {
    throw new Error("Expected an array of totalapi provider records.");
  }

  const normalized = normalizeTotalApiProviderCollection(payload, { sourceSystem });
  const outputPath = inputPath.replace(/\.json$/i, ".normalized.json");

  fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2), "utf-8");

  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log("Sample normalized record:");
  console.log(JSON.stringify(normalized[0], null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
