import { sanitizePostgresText } from "./postgres-sanitize.ts";
import type { BrainResult, JsonObject } from "./types.ts";

export class StructuredOutputError extends Error {
  code: "STRUCTURED_OUTPUT_TRUNCATED" | "STRUCTURED_OUTPUT_INVALID";

  constructor(code: "STRUCTURED_OUTPUT_TRUNCATED" | "STRUCTURED_OUTPUT_INVALID") {
    super(code);
    this.code = code;
  }
}

function structuralEdge(value: string): string {
  return [...value].map((character) => {
    if (`{}[]:,"`.includes(character)) return character;
    if (/\s/.test(character)) return "_";
    return "·";
  }).join("");
}

export function structuredOutputDiagnostics(result: BrainResult, scope: string): JsonObject {
  const content = sanitizePostgresText(result.content);
  const trimmed = content.trim();
  return {
    scope: sanitizePostgresText(scope).slice(0, 80),
    content_length: content.length,
    finish_reason: result.finishReason,
    starts_with_object: trimmed.startsWith("{"),
    ends_with_object: trimmed.endsWith("}"),
    leading_structure: structuralEdge(trimmed.slice(0, 12)),
    trailing_structure: structuralEdge(trimmed.slice(-12)),
    provider_model: sanitizePostgresText(result.providerModel).slice(0, 200),
    request_id: result.requestId ? sanitizePostgresText(result.requestId).slice(0, 200) : null,
  };
}

export function parseStructuredJson(result: BrainResult, scope: string): JsonObject {
  const diagnostics = structuredOutputDiagnostics(result, scope);
  if (result.finishReason === "length") {
    console.error("STRUCTURED_OUTPUT_TRUNCATED", diagnostics);
    throw new StructuredOutputError("STRUCTURED_OUTPUT_TRUNCATED");
  }

  const content = sanitizePostgresText(result.content).trim();
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not-object");
    return parsed as JsonObject;
  } catch {
    console.error("STRUCTURED_OUTPUT_INVALID", diagnostics);
    throw new StructuredOutputError("STRUCTURED_OUTPUT_INVALID");
  }
}
