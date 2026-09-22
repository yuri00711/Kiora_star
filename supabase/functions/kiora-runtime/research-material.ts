import { sanitizePostgresText } from "./postgres-sanitize.ts";

export type ResearchEvidenceKind = "direct_body" | "provider_raw" | "provider_snippet";

export interface SelectedResearchMaterial {
  text: string;
  evidenceKind: ResearchEvidenceKind;
  snippetOnly: boolean;
  providerExtracted: boolean;
}

export interface ResearchMaterialDiagnostics {
  discovered_source_count: number;
  direct_fetch_success_count: number;
  readable_source_count: number;
  direct_text_chars: number;
  provider_fallback_source_count: number;
  provider_fallback_text_chars: number;
  extraction_source_count: number;
  extraction_text_chars: number;
}

export function normalizeReadableText(value: unknown, maxChars = 18_000): string {
  const limit = Math.min(80_000, Math.max(1, Math.trunc(maxChars) || 18_000));
  return sanitizePostgresText(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

export function readableBodyIsUsable(value: unknown, minimumChars = 40): boolean {
  const text = normalizeReadableText(value, 80_000);
  if (!text) return false;
  const minimum = Math.min(500, Math.max(1, Math.trunc(minimumChars) || 40));
  const meaningful = text.replace(/[\s\p{P}\p{S}]+/gu, "");
  if (meaningful.length < minimum) return false;
  const shellMessage = text.toLowerCase().replace(/[\s.!]+/g, " ").trim();
  return !/^(?:please )?(?:enable|turn on) javascript(?: to (?:continue|view this (?:site|page)))?$/.test(shellMessage) &&
    !/^javascript (?:is )?required(?: to (?:continue|view this (?:site|page)))?$/.test(shellMessage) &&
    !/^loading(?: please wait)?$/.test(shellMessage);
}

export function selectResearchMaterial(input: {
  directText?: unknown;
  providerRawContent?: unknown;
  providerSnippet?: unknown;
  maxChars?: number;
}): SelectedResearchMaterial | null {
  const maxChars = input.maxChars ?? 18_000;
  const directText = normalizeReadableText(input.directText, maxChars);
  if (directText) {
    return {
      text: directText,
      evidenceKind: "direct_body",
      snippetOnly: false,
      providerExtracted: false,
    };
  }

  const providerRawContent = normalizeReadableText(input.providerRawContent, maxChars);
  if (providerRawContent) {
    return {
      text: providerRawContent,
      evidenceKind: "provider_raw",
      snippetOnly: false,
      providerExtracted: true,
    };
  }

  const providerSnippet = normalizeReadableText(input.providerSnippet, Math.min(maxChars, 6_000));
  if (providerSnippet) {
    return {
      text: providerSnippet,
      evidenceKind: "provider_snippet",
      snippetOnly: true,
      providerExtracted: true,
    };
  }

  return null;
}

export function chunkReadableMaterial(value: unknown, chunkChars = 6_000): string[] {
  const text = normalizeReadableText(value, 80_000);
  if (!text) return [];
  const size = Math.min(12_000, Math.max(500, Math.trunc(chunkChars) || 6_000));
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) {
    const chunk = text.slice(offset, offset + size).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

export function researchMaterialDiagnostics(
  discoveredSourceCount: number,
  sources: Array<{ ref?: unknown; text?: unknown; evidence_kind?: unknown }>,
): ResearchMaterialDiagnostics {
  const readable = sources.map((source) => ({
    ref: String(source.ref ?? ""),
    text: normalizeReadableText(source.text, 80_000),
    evidenceKind: String(source.evidence_kind ?? ""),
  })).filter((source) => source.text.length > 0);
  const direct = readable.filter((source) => source.evidenceKind === "direct_body");
  const providerFallback = readable.filter((source) =>
    source.evidenceKind === "provider_raw" || source.evidenceKind === "provider_snippet"
  );
  const extractionRefs = new Set(readable.map((source) => source.ref).filter(Boolean));

  return {
    discovered_source_count: Math.max(0, Math.trunc(discoveredSourceCount) || 0),
    direct_fetch_success_count: direct.length,
    readable_source_count: readable.length,
    direct_text_chars: direct.reduce((sum, source) => sum + source.text.length, 0),
    provider_fallback_source_count: providerFallback.length,
    provider_fallback_text_chars: providerFallback.reduce((sum, source) => sum + source.text.length, 0),
    extraction_source_count: extractionRefs.size,
    extraction_text_chars: readable.reduce((sum, source) => sum + source.text.length, 0),
  };
}

export function hasExtractionMaterial(diagnostics: ResearchMaterialDiagnostics): boolean {
  return diagnostics.extraction_source_count > 0 && diagnostics.extraction_text_chars > 0;
}
