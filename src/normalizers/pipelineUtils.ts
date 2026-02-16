// src/normalizers/pipelineUtils.ts

export function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }
  
  export function dedupeStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
  
    for (const value of values) {
      const normalized = normalizeWhitespace(value);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  
    return out;
  }
  