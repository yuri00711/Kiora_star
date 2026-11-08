export const GROWTH_SCOPES = [
  "communication_style",
  "response_behavior",
  "relationship_behavior",
  "preference_handling",
  "correction_rule",
  "conversational_habit",
] as const;

export type GrowthScope = typeof GROWTH_SCOPES[number];
export type CompilerCandidate = Record<string, unknown>;
export type CompiledGrowthRule = {
  scope: GrowthScope;
  instruction: string;
  priority: number;
  source_candidate_id: string;
  evidence_strength: number;
  created_at: string;
  supersedes_candidate_id: string | null;
  enabled: boolean;
  rule_key: string;
  relevance_terms: string[];
};
export type GrowthConflict = {
  left_candidate_id: string;
  right_candidate_id: string;
  classification: "conflict" | "supersedes" | "duplicate";
  resolution: "resolved" | "unresolved";
  winner_candidate_id: string | null;
  reason: string;
};
export type GrowthCompilation = {
  status: "valid" | "conflicted";
  rules: CompiledGrowthRule[];
  conflicts: GrowthConflict[];
  source_candidate_ids: string[];
  unresolved_conflict_count: number;
};

const ALLOWED_SCOPES = new Set<string>(GROWTH_SCOPES);
const SOURCE_PRIORITY: Record<string, number> = {
  correction: 100,
  explicit_feedback: 90,
  repeated_conversation_pattern: 75,
  memory_evidence: 65,
  relationship_evidence: 65,
  reflection: 50,
};

const PROTECTED_TARGET = /(?:core\s*(?:identity|definition|principle)|owner\s*(?:identity|permission)|auth(?:entication|orization)?|row[-\s]?level\s+security|\brls\b|safety\s*(?:rule|policy)|tool\s*(?:permission|authority)|system\s*(?:security|policy)|budget\s*(?:limit|policy)|raw\s+memory\s+evidence|factual\s+knowledge|核心身份|所有者权限|身份认证|行级安全|安全规则|工具权限|预算限制|原始记忆证据|事实知识)/iu;

function text(value: unknown, max = 800): string {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

function scopeFor(candidate: CompilerCandidate): GrowthScope | null {
  const explicit = text(candidate.growth_scope, 80);
  if (ALLOWED_SCOPES.has(explicit)) return explicit as GrowthScope;
  const type = text(candidate.candidate_type, 80);
  const mapped: Record<string, GrowthScope> = {
    communication_preference: "communication_style",
    correction: "correction_rule",
    failure_pattern: "response_behavior",
    relationship_pattern: "relationship_behavior",
    behavioral_preference: "preference_handling",
    response_style: "communication_style",
  };
  return mapped[type] || null;
}

function normalizedInstruction(value: unknown): string {
  return text(value, 420).toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

function relevanceTerms(value: string): string[] {
  const normalized = value.toLocaleLowerCase().normalize("NFKC");
  const terms = new Set<string>();
  for (const item of normalized.match(/[a-z0-9_]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,}/gu) || []) {
    terms.add(item);
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(item) && item.length > 1) {
      for (let index = 0; index < item.length - 1; index += 1) terms.add(item.slice(index, index + 2));
    }
  }
  return [...terms].slice(0, 48);
}

function ruleKey(candidate: CompilerCandidate, scope: GrowthScope): string {
  const provided = text(candidate.rule_key, 160).toLocaleLowerCase().replace(/[^a-z0-9_:\-\p{L}\p{N}]+/gu, "-");
  if (provided) return provided;
  const title = text(candidate.title || candidate.candidate_type, 120).toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${scope}:${title || "general"}`;
}

export function safeGrowthInstruction(value: unknown): string {
  const instruction = text(value, 420);
  const vague = /^(更理解|更加理解|be better|understand better|もっと理解)[。.!！]?$/iu.test(instruction);
  return vague || instruction.length < 8 || PROTECTED_TARGET.test(instruction) ? "" : instruction;
}

function instructionFor(candidate: CompilerCandidate): string {
  return safeGrowthInstruction(candidate.activation_instruction || candidate.proposal);
}

function candidatePriority(candidate: CompilerCandidate): number {
  const base = SOURCE_PRIORITY[text(candidate.source_kind, 80)] || 0;
  const manual = Math.max(-10, Math.min(10, Number(candidate.priority) || 0));
  return base + manual;
}

function createdTime(value: unknown): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compileGrowthCandidates(candidates: CompilerCandidate[]): GrowthCompilation {
  const rules: CompiledGrowthRule[] = candidates.map((candidate) => {
    const id = text(candidate.id, 80);
    const scope = scopeFor(candidate);
    const instruction = instructionFor(candidate);
    if (!id || !scope || !instruction) throw new Error("GROWTH_CANDIDATE_NOT_COMPILABLE");
    const sourceRank = SOURCE_PRIORITY[text(candidate.source_kind, 80)] || 0;
    return {
      scope,
      instruction,
      priority: candidatePriority(candidate),
      source_candidate_id: id,
      evidence_strength: sourceRank / 100,
      created_at: String(candidate.created_at || new Date(0).toISOString()),
      supersedes_candidate_id: text(candidate.supersedes_candidate_id, 80) || null,
      enabled: true,
      rule_key: ruleKey(candidate, scope),
      relevance_terms: relevanceTerms(`${instruction} ${text(candidate.title, 240)}`),
    };
  });
  const conflicts: GrowthConflict[] = [];
  const ordered = [...rules].sort((left, right) => right.priority - left.priority
    || createdTime(right.created_at) - createdTime(left.created_at)
    || left.source_candidate_id.localeCompare(right.source_candidate_id));
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex];
    if (!left.enabled) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const right = ordered[rightIndex];
      if (!right.enabled) continue;
      const leftNormalized = normalizedInstruction(left.instruction);
      const rightNormalized = normalizedInstruction(right.instruction);
      if (leftNormalized === rightNormalized) {
        right.enabled = false;
        conflicts.push({ left_candidate_id: left.source_candidate_id, right_candidate_id: right.source_candidate_id,
          classification: "duplicate", resolution: "resolved", winner_candidate_id: left.source_candidate_id,
          reason: "Normalized behavior instruction is identical." });
        continue;
      }
      if (left.supersedes_candidate_id === right.source_candidate_id || right.supersedes_candidate_id === left.source_candidate_id) {
        const winner = left.supersedes_candidate_id === right.source_candidate_id ? left : right;
        const loser = winner === left ? right : left;
        loser.enabled = false;
        conflicts.push({ left_candidate_id: left.source_candidate_id, right_candidate_id: right.source_candidate_id,
          classification: "supersedes", resolution: "resolved", winner_candidate_id: winner.source_candidate_id,
          reason: "An explicit reviewed supersedes relation resolves these rules." });
        continue;
      }
      // Different conflict keys are compatible behavior domains. They remain
      // enabled without producing a conflict row.
      if (left.rule_key !== right.rule_key) continue;
      if (left.priority !== right.priority) {
        const winner = left.priority > right.priority ? left : right;
        const loser = winner === left ? right : left;
        loser.enabled = false;
        conflicts.push({ left_candidate_id: left.source_candidate_id, right_candidate_id: right.source_candidate_id,
          classification: "supersedes", resolution: "resolved", winner_candidate_id: winner.source_candidate_id,
          reason: "Evidence-source priority resolved the conflict; confidence alone was not used." });
        continue;
      }
      left.enabled = false;
      right.enabled = false;
      conflicts.push({ left_candidate_id: left.source_candidate_id, right_candidate_id: right.source_candidate_id,
        classification: "conflict", resolution: "unresolved", winner_candidate_id: null,
        reason: "Equal-priority incompatible rules require OWNER review; the previous active behavior remains." });
    }
  }
  const unresolved = conflicts.filter((item) => item.resolution === "unresolved").length;
  return {
    status: unresolved ? "conflicted" : "valid",
    rules,
    conflicts,
    source_candidate_ids: rules.map((item) => item.source_candidate_id),
    unresolved_conflict_count: unresolved,
  };
}

export function canonicalGrowthCompilation(compilation: GrowthCompilation): string {
  return JSON.stringify({
    compiler_version: "phase4b-deterministic-v1",
    status: compilation.status,
    rules: [...compilation.rules].sort((a, b) => a.source_candidate_id.localeCompare(b.source_candidate_id)),
    conflicts: [...compilation.conflicts].sort((a, b) => `${a.left_candidate_id}:${a.right_candidate_id}`.localeCompare(`${b.left_candidate_id}:${b.right_candidate_id}`)),
  });
}
