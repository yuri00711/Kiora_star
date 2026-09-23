import { sanitizePostgresText } from "./postgres-sanitize.ts";
import { providerExtractUrlEquivalent } from "./research-url-policy.ts";
import type { JsonObject } from "./types.ts";

export type ParsedProviderExtract = {
  requestedUrl: string;
  returnedUrl: string;
  rawContent: string;
};

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

export function parseTavilyExtractPayload(
  payload: unknown,
  requestedUrl: string,
  maxChars = 18_000,
  projectUrl = "",
): ParsedProviderExtract | null {
  const rows = object(payload).results;
  if (!Array.isArray(rows)) return null;
  const limit = Math.min(80_000, Math.max(1, Math.trunc(maxChars) || 18_000));
  for (const value of rows) {
    const row = object(value);
    const returnedValue = sanitizePostgresText(row.url).trim();
    if (!providerExtractUrlEquivalent(requestedUrl, returnedValue, projectUrl)) continue;
    const rawContent = sanitizePostgresText(row.raw_content).trim().slice(0, limit);
    if (!rawContent) continue;
    const returnedUrl = new URL(returnedValue);
    returnedUrl.hash = "";
    return { requestedUrl, returnedUrl: returnedUrl.href, rawContent };
  }
  return null;
}
