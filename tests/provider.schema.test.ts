import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ProviderArraySchema } from "../src/schemas/provider.schema";

describe("Provider Schema Validation", () => {
  it("validates demo Sanity output JSON", () => {
    const filePath = path.join(
      process.cwd(),
      "examples",
      "demo-outputs",
      "Portland_Homeless_shelter_sanity.json"
    );

    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    const result = ProviderArraySchema.safeParse(data);
    if (!result.success) {
      // 어떤 인덱스/필드가 깨졌는지 출력
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});
