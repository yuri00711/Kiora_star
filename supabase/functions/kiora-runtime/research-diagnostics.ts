import type { JsonObject } from "./types.ts";

function redactDiagnostic(value: unknown, limit: number): string {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
    .replace(/\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{16,}\b/gi, "[REDACTED_SECRET]")
    .replace(/([?&](?:key|api_key|token|access_token|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, limit);
}

export function safeResearchErrorDetails(error: unknown): JsonObject {
  if (error instanceof Error) {
    const maybe = error as Error & { code?: unknown; details?: unknown; hint?: unknown };
    return {
      name: redactDiagnostic(error.name, 160),
      message: redactDiagnostic(error.message, 600),
      code: maybe.code == null ? null : redactDiagnostic(maybe.code, 160),
      details: maybe.details == null ? null : redactDiagnostic(maybe.details, 600),
      hint: maybe.hint == null ? null : redactDiagnostic(maybe.hint, 600),
    };
  }
  if (error && typeof error === "object") {
    const value = error as JsonObject;
    return {
      name: typeof value.name === "string" ? redactDiagnostic(value.name, 160) : "NON_ERROR_OBJECT",
      message: typeof value.message === "string" ? redactDiagnostic(value.message, 600) : "",
      code: value.code == null ? null : redactDiagnostic(value.code, 160),
      details: value.details == null ? null : redactDiagnostic(value.details, 600),
      hint: value.hint == null ? null : redactDiagnostic(value.hint, 600),
    };
  }
  return { name: typeof error, message: redactDiagnostic(error, 600) };
}

export function shouldRetryZeroClaims(
  extractedClaimCount: number,
  readableSourceCount: number,
  retryAlreadyAttempted: boolean,
): boolean {
  return !retryAlreadyAttempted && extractedClaimCount === 0 && readableSourceCount > 0;
}

export function researchOutcomeStatus(
  readableSourceCount: number,
  groundedClaimCount: number,
): "no_reliable_sources" | "no_grounded_claims" | "completed" {
  if (readableSourceCount === 0) return "no_reliable_sources";
  return groundedClaimCount > 0 ? "completed" : "no_grounded_claims";
}

function normalizeGroundingText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function evidenceIsGrounded(haystackValue: unknown, excerptValue: unknown): boolean {
  const haystack = normalizeGroundingText(haystackValue);
  const excerpt = normalizeGroundingText(excerptValue);
  if (excerpt.length < 12) return false;
  if (haystack.includes(excerpt)) return true;
  const compactHaystack = haystack.replace(/[\p{P}\p{S}\s]+/gu, "");
  const compactExcerpt = excerpt.replace(/[\p{P}\p{S}\s]+/gu, "");
  return compactExcerpt.length >= 12 && compactHaystack.includes(compactExcerpt);
}
