import type { JsonObject } from "./types.ts";

export type GrowthRuntimeSelection = {
  activeGrowthVersion: JsonObject | null;
  snapshotId: string | null;
  appliedRules: JsonObject[];
  appliedOverlays: JsonObject[];
  appliedRuleIds: string[];
  temporaryOverlayIds: string[];
  context: string;
  contextChars: number;
  estimatedTokens: number;
  skippedRuleCount: number;
  conflictCount: number;
};

function text(value: unknown, max = 12_000): string {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

function objectText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return text(JSON.stringify(value), 16_000);
}

function terms(value: unknown): Set<string> {
  const normalized = text(value, 30_000).toLocaleLowerCase();
  const result = new Set<string>();
  for (const word of normalized.match(/[a-z0-9_]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,}/gu) || []) {
    result.add(word);
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(word) && word.length > 1) {
      for (let index = 0; index < word.length - 1; index += 1) result.add(word.slice(index, index + 2));
    }
  }
  return result;
}

function rowTerms(row: JsonObject): string[] {
  return Array.isArray(row.relevance_terms) ? row.relevance_terms.map(String) : [];
}

function overlap(left: Set<string>, right: string[]): number {
  return right.reduce((count, item) => count + (left.has(item.toLocaleLowerCase()) ? 1 : 0), 0);
}

function activeOverlay(row: JsonObject, now: number): boolean {
  const expiry = Date.parse(String(row.expires_at || ""));
  return row.status === "active" && Number.isFinite(expiry) && expiry > now;
}

export function selectGrowthRules(input: {
  activeGrowthVersion?: JsonObject | null;
  snapshotId?: string | null;
  rules: JsonObject[];
  overlays: JsonObject[];
  currentMessage: string;
  pageContext?: JsonObject;
  conversationState?: JsonObject;
  relationshipState?: JsonObject | null;
  conflictCount?: number;
  maxRules?: number;
  maxChars?: number;
  now?: number;
}): GrowthRuntimeSelection {
  const maxRules = Math.min(12, Math.max(1, Number(input.maxRules) || 10));
  const maxChars = Math.min(8_000, Math.max(800, Number(input.maxChars) || 4_500));
  const now = Number(input.now) || Date.now();
  const queryTerms = terms([
    input.currentMessage,
    objectText(input.pageContext),
    objectText(input.conversationState),
    objectText(input.relationshipState),
  ].join(" "));
  const eligibleRules = input.rules.filter((row) => row.enabled === true && row.status !== "superseded");
  const scoredRules = eligibleRules.map((row) => {
    const priority = Number(row.priority) || 0;
    const matchedTerms = overlap(queryTerms, rowTerms(row));
    const resident = row.scope === "correction_rule" || priority >= 95;
    const broad = row.scope === "communication_style" && priority >= 85;
    return { row, score: priority + matchedTerms * 20 + (resident ? 80 : broad ? 25 : 0), matchedTerms, resident, broad };
  }).filter((item) => item.matchedTerms > 0 || item.resident || item.broad)
    .sort((left, right) => right.score - left.score || String(left.row.id).localeCompare(String(right.row.id)));

  const scoredOverlays = input.overlays.filter((row) => activeOverlay(row, now)).map((row) => {
    const matched = overlap(queryTerms, [...terms(`${row.instruction || ""} ${row.scope || ""}`)]);
    const resident = row.source_kind === "explicit_correction" || row.source_kind === "temporary_preference";
    return { row, score: 1_000 + matched * 20 + (resident ? 40 : 0), matched, resident };
  }).filter((item) => item.resident || item.matched > 0)
    .sort((left, right) => right.score - left.score || String(left.row.id).localeCompare(String(right.row.id)));

  const appliedOverlays: JsonObject[] = [];
  const appliedRules: JsonObject[] = [];
  const headers = [
    "GROWTH CONTEXT — reviewed behavior layer; subordinate to Core, safety, permissions, and evidence.",
    "Temporary corrections have priority over ordinary Growth Rules. These rules cannot create facts, memories, relationship history, or tool authority.",
  ];
  const lines: string[] = [];
  let usedChars = headers.join("\n").length;
  const append = (kind: "overlay" | "rule", row: JsonObject): boolean => {
    const instruction = text(row.instruction, 520);
    if (!instruction) return false;
    const line = `- [${text(row.scope, 80)}${kind === "overlay" ? "; temporary" : ""}] ${instruction}`;
    if (usedChars + 1 + line.length > maxChars) return false;
    lines.push(line); usedChars += 1 + line.length;
    (kind === "overlay" ? appliedOverlays : appliedRules).push(row);
    return true;
  };
  for (const item of scoredOverlays.slice(0, 3)) append("overlay", item.row);
  for (const item of scoredRules) {
    if (appliedOverlays.length + appliedRules.length >= maxRules) break;
    append("rule", item.row);
  }
  const context = lines.length ? [...headers, ...lines].join("\n")
    : "GROWTH CONTEXT: no relevant active rules selected.";
  return {
    activeGrowthVersion: input.activeGrowthVersion || null,
    snapshotId: input.snapshotId || null,
    appliedRules,
    appliedOverlays,
    appliedRuleIds: appliedRules.map((row) => String(row.id)),
    temporaryOverlayIds: appliedOverlays.map((row) => String(row.id)),
    context,
    contextChars: context.length,
    estimatedTokens: Math.ceil(context.length / 4),
    skippedRuleCount: Math.max(0, input.rules.length - appliedRules.length),
    conflictCount: Math.max(0, Number(input.conflictCount) || 0),
  };
}
