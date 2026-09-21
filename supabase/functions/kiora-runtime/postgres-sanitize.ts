import type { JsonObject } from "./types.ts";

/**
 * PostgreSQL text/jsonb cannot represent U+0000, and its JSON parser rejects
 * escaped unpaired UTF-16 surrogates. Keep valid Unicode intact while removing
 * unsafe C0 controls and replacing malformed surrogate code units with U+FFFD.
 */
export function sanitizePostgresText(value: unknown): string {
  const input = String(value ?? "");
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code === 0) continue;
    if (code <= 0x1f) {
      if (code === 0x09 || code === 0x0a || code === 0x0d) output += " ";
      continue;
    }
    if (code === 0x7f) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[index] + input[index + 1];
        index += 1;
      } else {
        output += "\ufffd";
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      output += "\ufffd";
      continue;
    }
    output += input[index];
  }
  return output;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return sanitizePostgresText(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return null;
  if (Array.isArray(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    const result = value.map((item) => sanitizeValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) return null;
    seen.add(value);
    const result: JsonObject = {};
    for (const [rawKey, item] of Object.entries(value)) {
      result[sanitizePostgresText(rawKey)] = sanitizeValue(item, seen) as JsonObject[string];
    }
    seen.delete(value);
    return result;
  }
  return null;
}

export function sanitizePostgresJson<T>(value: T): T {
  return sanitizeValue(value, new WeakSet()) as T;
}

export function sanitizeSourceRecordsForRpc(records: JsonObject[]): JsonObject[] {
  return sanitizePostgresJson(records);
}
