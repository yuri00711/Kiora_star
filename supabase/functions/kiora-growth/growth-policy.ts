export type GrowthJson = Record<string, unknown>;

export type GrowthCandidateDraft = {
  candidateType: "communication_preference" | "correction" | "failure_pattern" | "relationship_pattern" | "behavioral_preference" | "response_style";
  title: string;
  proposal: string;
  rationale: string;
  evidenceRefs: string[];
  confidence: number;
  sourceKind: "explicit_feedback" | "correction" | "reflection" | "memory_evidence" | "relationship_evidence" | "repeated_conversation_pattern";
};

function text(value: unknown, max = 6_000): string {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function object(value: unknown): GrowthJson {
  return value && typeof value === "object" && !Array.isArray(value) ? value as GrowthJson : {};
}

function strings(value: unknown, max = 40): string[] {
  return (Array.isArray(value) ? value : []).map((item) => text(item, 500)).filter(Boolean).slice(0, max);
}

export function candidateFromFeedback(feedback: GrowthJson): GrowthCandidateDraft | null {
  const id = text(feedback.id, 80);
  const messageId = text(feedback.message_id, 80);
  const content = text(feedback.content);
  const type = text(feedback.feedback_type, 80);
  if (!id || !content || !["accepted", "rejected", "correction", "preference"].includes(type)) return null;
  const evidenceRefs = [`feedback:${id}`, ...(messageId ? [`message:${messageId}`] : [])];
  if (type === "correction") return {
    candidateType: "correction", title: "Explicit OWNER correction", proposal: content,
    rationale: "The OWNER explicitly corrected Kiora; review before turning it into durable behavior.",
    evidenceRefs, confidence: 0.98, sourceKind: "correction",
  };
  if (type === "preference") return {
    candidateType: "communication_preference", title: "Explicit communication preference", proposal: content,
    rationale: "The OWNER explicitly stated a future communication preference.",
    evidenceRefs, confidence: 0.96, sourceKind: "explicit_feedback",
  };
  if (type === "rejected") return {
    candidateType: "failure_pattern", title: "Rejected response pattern", proposal: content,
    rationale: "The OWNER explicitly rejected a response pattern; it remains a reviewable candidate, not an automatic personality change.",
    evidenceRefs, confidence: 0.94, sourceKind: "explicit_feedback",
  };
  return {
    candidateType: "response_style", title: "Accepted response style", proposal: content,
    rationale: "The OWNER explicitly accepted this response style.",
    evidenceRefs, confidence: 0.9, sourceKind: "explicit_feedback",
  };
}

function repeatedKey(feedback: GrowthJson): string {
  return `${text(feedback.feedback_type, 80)}:${text(feedback.content).toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "")}`;
}

export function repeatedFeedbackCandidates(feedbackRows: GrowthJson[]): GrowthCandidateDraft[] {
  const groups = new Map<string, GrowthJson[]>();
  for (const row of feedbackRows) {
    const candidate = candidateFromFeedback(row);
    const key = candidate ? repeatedKey(row) : "";
    if (!key || key.endsWith(":")) continue;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const results: GrowthCandidateDraft[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const latest = candidateFromFeedback(rows[0]);
    if (!latest) continue;
    results.push({
      ...latest,
      candidateType: latest.candidateType === "correction" ? "failure_pattern" : latest.candidateType,
      title: `Repeated pattern: ${latest.title}`,
      rationale: `The same OWNER feedback pattern appeared ${rows.length} times across stored feedback evidence.`,
      evidenceRefs: rows.flatMap((row) => {
        const id = text(row.id, 80);
        const messageId = text(row.message_id, 80);
        return [`feedback:${id}`, ...(messageId ? [`message:${messageId}`] : [])];
      }),
      confidence: Math.min(0.99, latest.confidence + 0.02),
      sourceKind: "repeated_conversation_pattern",
    });
  }
  return results;
}

export function growthChangesRespectProtectedBoundaries(value: unknown): boolean {
  const forbidden = new Set(["core", "core_identity", "owner", "owner_id", "rls", "memory", "memory_evidence", "knowledge", "knowledge_sources", "agency", "tools"]);
  const walk = (item: unknown): boolean => {
    if (Array.isArray(item)) return item.every(walk);
    if (!item || typeof item !== "object") return true;
    for (const [key, nested] of Object.entries(item as GrowthJson)) {
      if (forbidden.has(key.toLocaleLowerCase())) return false;
      if (!walk(nested)) return false;
    }
    return true;
  };
  return walk(value);
}

export function evaluateShadowOutput(
  outputValue: unknown,
  expectedValue: unknown,
  prohibitedValue: unknown,
): { passed: boolean; notes: string } {
  const output = text(outputValue, 30_000);
  const normalized = output.toLocaleLowerCase();
  const expected = object(expectedValue);
  const prohibited = object(prohibitedValue);
  const required = strings(expected.must_include).map((item) => item.toLocaleLowerCase());
  const forbidden = strings(prohibited.must_not_include).map((item) => item.toLocaleLowerCase());
  const failures: string[] = [];
  if (expected.nonempty === true && !output) failures.push("empty_output");
  const missing = required.filter((item) => !normalized.includes(item));
  const present = forbidden.filter((item) => normalized.includes(item));
  if (missing.length) failures.push(`missing_required:${missing.length}`);
  if (present.length) failures.push(`prohibited_present:${present.length}`);
  return { passed: failures.length === 0, notes: failures.length ? failures.join(",") : "case_passed" };
}

export function shadowMessages(
  intendedChangesValue: unknown,
  evalCaseValue: unknown,
): Array<{ role: "system" | "user"; content: string }> {
  const intendedChanges = object(intendedChangesValue);
  const evalCase = object(evalCaseValue);
  return [{
    role: "system",
    content: [
      "You are running an isolated Kiora Growth Version shadow evaluation.",
      "Produce a candidate response only. Do not write Memory, Relationship, Knowledge, Core, messages, or tools.",
      "Do not claim that any tool action was executed. This output is invisible to the OWNER and is evaluation data only.",
      `COMPILED CANDIDATE GROWTH RULES (reviewed behavior data, subordinate to Core and safety): ${JSON.stringify(intendedChanges)}`,
    ].join("\n"),
  }, {
    role: "user",
    content: JSON.stringify({ evaluation_input: object(evalCase.input), suite: evalCase.suite, name: evalCase.name }),
  }];
}
