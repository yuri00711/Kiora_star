import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { KioraRuntimeError, requireKioraOwner } from "../_shared/kiora-owner.ts";
import { adapterFor } from "../kiora-runtime/brain-adapters.ts";
import { assertGrowthBudget, budgetSnapshot, calculateCost } from "../kiora-runtime/budget-manager.ts";
import type { JsonObject, ModelRecord } from "../kiora-runtime/types.ts";
import {
  candidateFromFeedback,
  evaluateShadowOutput,
  growthChangesRespectProtectedBoundaries,
  repeatedFeedbackCandidates,
  shadowMessages,
  type GrowthCandidateDraft,
} from "./growth-policy.ts";
import { canonicalGrowthCompilation, compileGrowthCandidates, safeGrowthInstruction } from "./growth-compiler.ts";

const ACTIONS = new Set([
  "status", "collect_candidates", "collect_memory_evidence", "collect_relationship_evidence",
  "review_candidate", "create_training_example", "review_training_example",
  "create_dataset", "freeze_dataset", "create_growth_version", "start_testing",
  "upsert_eval_case", "set_shadow_testing", "run_shadow_test",
  "prepare_candidate", "compile_growth_version", "create_regression_gate",
  "create_temporary_overlay", "dismiss_temporary_overlay", "promote_temporary_overlay",
  "record_growth_feedback", "growth_diagnostics",
  "promote_growth_version", "reject_growth_version", "retire_growth_version", "rollback_growth_version",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max = 20_000): string {
  return String(value ?? "").trim().slice(0, max);
}

function uuid(value: unknown, code = "INVALID_ID"): string {
  const id = String(value ?? "");
  if (!UUID.test(id)) throw new KioraRuntimeError(code, 400);
  return id;
}

function futureIso(value: unknown, fallbackDays = 14): string {
  const fallback = Date.now() + fallbackDays * 86_400_000;
  const parsed = value === undefined || value === null || value === "" ? fallback : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new KioraRuntimeError("INVALID_GROWTH_OVERLAY", 400);
  return new Date(parsed).toISOString();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function runtimeError(error: unknown): KioraRuntimeError {
  if (error instanceof KioraRuntimeError) return error;
  const message = error instanceof Error ? error.message : String(object(error).message || "");
  const allowed = new Set([
    "KIORA_OWNER_REQUIRED", "KIORA_NOT_STARTED", "PHASE4A_NOT_ENABLED", "SHADOW_TESTING_DISABLED",
    "GROWTH_BUDGET_DEFERRED", "MODEL_NOT_FOUND",
    "INVALID_GROWTH_CANDIDATE_TYPE", "INVALID_GROWTH_SOURCE", "INVALID_GROWTH_CANDIDATE",
    "INVALID_GROWTH_CANDIDATES", "INVALID_GROWTH_EVIDENCE", "REPEATED_PATTERN_EVIDENCE_REQUIRED",
    "INVALID_GROWTH_EVENT_REFERENCE", "INVALID_CANDIDATE_DECISION", "REFLECTION_RUN_NOT_FOUND",
    "GROWTH_CANDIDATE_NOT_REVIEWABLE", "ACCEPTED_GROWTH_CANDIDATE_REQUIRED",
    "INVALID_TRAINING_EXAMPLE_TYPE", "INVALID_TRAINING_EXAMPLE", "INVALID_TRAINING_EXAMPLE_DECISION",
    "TRAINING_EXAMPLE_NOT_REVIEWABLE", "DATASET_FROZEN", "DATASET_RETIRED",
    "INVALID_DATASET_VERSION", "TRAINING_EXAMPLE_NOT_FOUND", "DATASET_NOT_FOUND", "DATASET_NOT_FREEZABLE",
    "DATASET_EMPTY", "DATASET_HAS_UNREVIEWED_EXAMPLES", "INVALID_GROWTH_VERSION", "GROWTH_PROTECTED_BOUNDARY",
    "FROZEN_DATASET_REQUIRED", "BASE_GROWTH_VERSION_NOT_FOUND", "GROWTH_VERSION_NOT_TESTABLE", "INVALID_EVAL_CASE",
    "EVAL_CASE_NOT_FOUND", "NO_EVAL_CASES", "SHADOW_TEST_NOT_RUNNING", "EVAL_CASE_NOT_IN_SHADOW_TEST",
    "GROWTH_VERSION_NOT_PROMOTABLE", "PASSING_SHADOW_TEST_REQUIRED", "AUTO_PROMOTION_FORBIDDEN",
    "GROWTH_VERSION_NOT_REJECTABLE", "GROWTH_VERSION_NOT_RETIRABLE", "ROLLBACK_TARGET_NOT_FOUND",
    "PHASE4B_NOT_ENABLED", "INVALID_GROWTH_ACTIVATION_METADATA", "GROWTH_CANDIDATE_ALREADY_COMPILED",
    "SUPERSEDED_CANDIDATE_NOT_FOUND", "GROWTH_CANDIDATE_NOT_PREPARABLE", "GROWTH_CANDIDATE_NOT_COMPILABLE",
    "INVALID_GROWTH_COMPILATION", "GROWTH_VERSION_NOT_COMPILABLE", "GROWTH_SNAPSHOT_IMMUTABLE",
    "GROWTH_COMPILATION_CANDIDATE_MISMATCH", "GROWTH_COMPILATION_STATUS_MISMATCH",
    "INVALID_COMPILED_GROWTH_RULE", "INVALID_GROWTH_CONFLICT", "INVALID_GROWTH_OVERLAY",
    "GROWTH_OVERLAY_SOURCE_NOT_FOUND", "GROWTH_OVERLAY_NOT_ACTIVE", "GROWTH_OVERLAY_NOT_FOUND",
    "VALID_GROWTH_SNAPSHOT_REQUIRED", "SHADOW_TEST_NOT_COMPLETE", "ACTIVATION_REASON_REQUIRED",
    "GROWTH_VERSION_NOT_ACTIVATABLE", "REGRESSION_GATE_NOT_PASSED", "ROLLBACK_REASON_REQUIRED",
    "RETIREMENT_REASON_REQUIRED", "PHASE4B_ACTIVATION_REQUIRED", "INVALID_GROWTH_FEEDBACK",
    "GROWTH_RULE_NOT_FOUND",
  ]);
  return allowed.has(message) ? new KioraRuntimeError(message, 400) : new KioraRuntimeError("GROWTH_RUNTIME_ERROR", 500);
}

async function settings(db: SupabaseClient, ownerId: string): Promise<JsonObject> {
  const { data, error } = await db.from("kiora_settings").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new KioraRuntimeError("GROWTH_SETTINGS_READ_FAILED", 500);
  if (!data) throw new KioraRuntimeError("KIORA_NOT_STARTED", 409);
  return data as JsonObject;
}

async function model(db: SupabaseClient, ownerId: string, modelId: string): Promise<ModelRecord> {
  const { data, error } = await db.from("kiora_models").select("*").eq("owner_id", ownerId).eq("id", modelId).maybeSingle();
  if (error || !data) throw new KioraRuntimeError("MODEL_NOT_FOUND", 404);
  return data as ModelRecord;
}

async function createCandidate(
  db: SupabaseClient,
  ownerId: string,
  draft: GrowthCandidateDraft,
  eventIds: string[] = [],
): Promise<JsonObject> {
  const { data, error } = await db.rpc("kiora_create_growth_candidate", {
    target_owner: ownerId,
    candidate_kind: draft.candidateType,
    candidate_title: draft.title,
    candidate_proposal: draft.proposal,
    candidate_rationale: draft.rationale,
    evidence_reference_list: draft.evidenceRefs,
    source_event_list: eventIds,
    candidate_confidence: draft.confidence,
    candidate_source_kind: draft.sourceKind,
  });
  if (error) throw error;
  return object(data);
}

function evidenceSignature(refs: unknown): string {
  return array(refs).map(String).sort().join("|");
}

async function collectCandidates(db: SupabaseClient, ownerId: string): Promise<JsonObject> {
  const [feedbackResult, existingResult] = await Promise.all([
    db.from("kiora_feedback").select("id,message_id,feedback_type,content,created_at")
      .eq("owner_id", ownerId).in("feedback_type", ["accepted", "rejected", "correction", "preference"])
      .order("created_at", { ascending: false }).limit(200),
    db.from("kiora_growth_candidates").select("id,evidence_refs,source_kind,status").eq("owner_id", ownerId).limit(1000),
  ]);
  if (feedbackResult.error || existingResult.error) throw new KioraRuntimeError("GROWTH_SOURCE_READ_FAILED", 500);
  const feedback = (feedbackResult.data || []) as JsonObject[];
  const feedbackIds = feedback.map((item) => String(item.id));
  const eventByFeedback = new Map<string, string[]>();
  if (feedbackIds.length) {
    const { data: events, error } = await db.from("kiora_events").select("id,feedback_id").eq("owner_id", ownerId).in("feedback_id", feedbackIds);
    if (error) throw new KioraRuntimeError("GROWTH_SOURCE_READ_FAILED", 500);
    for (const event of events || []) {
      const key = String(event.feedback_id || "");
      eventByFeedback.set(key, [...(eventByFeedback.get(key) || []), String(event.id)]);
    }
  }
  const existingSignatures = new Set((existingResult.data || []).map((row) => evidenceSignature(row.evidence_refs)));
  const created: JsonObject[] = [];
  for (const row of feedback) {
    const draft = candidateFromFeedback(row);
    if (!draft || existingSignatures.has(evidenceSignature(draft.evidenceRefs))) continue;
    created.push(await createCandidate(db, ownerId, draft, eventByFeedback.get(String(row.id)) || []));
    existingSignatures.add(evidenceSignature(draft.evidenceRefs));
  }
  for (const draft of repeatedFeedbackCandidates(feedback)) {
    if (existingSignatures.has(evidenceSignature(draft.evidenceRefs))) continue;
    const eventIds = draft.evidenceRefs
      .filter((ref) => ref.startsWith("feedback:"))
      .flatMap((ref) => eventByFeedback.get(ref.slice("feedback:".length)) || []);
    created.push(await createCandidate(db, ownerId, draft, [...new Set(eventIds)]));
    existingSignatures.add(evidenceSignature(draft.evidenceRefs));
  }
  return { created_count: created.length, candidate_ids: created.map((item) => item.id) };
}

async function collectMemoryEvidence(db: SupabaseClient, ownerId: string, evidenceId: string): Promise<JsonObject> {
  const { data: evidence, error } = await db.from("kiora_memory_evidence").select("*")
    .eq("owner_id", ownerId).eq("id", evidenceId).maybeSingle();
  if (error || !evidence) throw new KioraRuntimeError("MEMORY_EVIDENCE_NOT_FOUND", 404);
  const { data: memory, error: memoryError } = await db.from("kiora_memories").select("id,memory_type,summary,content,confidence,status")
    .eq("owner_id", ownerId).eq("id", evidence.memory_id).maybeSingle();
  if (memoryError || !memory) throw new KioraRuntimeError("MEMORY_EVIDENCE_NOT_FOUND", 404);
  const type = memory.memory_type === "relational" ? "relationship_pattern" : memory.memory_type === "procedural"
    ? "behavioral_preference" : "communication_preference";
  return createCandidate(db, ownerId, {
    candidateType: type,
    title: "Memory-evidenced growth proposal",
    proposal: text(memory.summary || memory.content, 6_000),
    rationale: "Derived from an existing Memory Evidence record; the original Memory remains unchanged.",
    evidenceRefs: [`memory:${memory.id}`, `memory_evidence:${evidence.id}`],
    confidence: Math.min(1, Math.max(0, Number(memory.confidence) || 0.5)),
    sourceKind: "memory_evidence",
  }, evidence.event_id ? [String(evidence.event_id)] : []);
}

async function collectRelationshipEvidence(db: SupabaseClient, ownerId: string, snapshotId: string): Promise<JsonObject> {
  const { data, error } = await db.from("kiora_relationship_snapshots").select("*")
    .eq("owner_id", ownerId).eq("id", snapshotId).maybeSingle();
  if (error || !data) throw new KioraRuntimeError("RELATIONSHIP_EVIDENCE_NOT_FOUND", 404);
  const patterns = array(data.interaction_patterns);
  const proposal = patterns.length ? JSON.stringify(patterns.slice(-5)) : text(data.relationship_definition, 6_000);
  return createCandidate(db, ownerId, {
    candidateType: "relationship_pattern",
    title: "Relationship-evidenced growth proposal",
    proposal: text(proposal, 6_000),
    rationale: "Derived from an existing relationship snapshot; the snapshot remains immutable evidence.",
    evidenceRefs: [`relationship_snapshot:${snapshotId}`],
    confidence: 0.72,
    sourceKind: "relationship_evidence",
  });
}

async function compileGrowthVersion(db: SupabaseClient, ownerId: string, growthVersionId: string): Promise<JsonObject> {
  const { data: version, error: versionError } = await db.from("kiora_growth_versions")
    .select("id,status,candidate_ids").eq("owner_id", ownerId).eq("id", growthVersionId).maybeSingle();
  if (versionError || !version || !["draft", "testing"].includes(String(version.status))) {
    throw new KioraRuntimeError("GROWTH_VERSION_NOT_COMPILABLE", 409);
  }
  const candidateIds = array(version.candidate_ids).map(String).filter((id) => UUID.test(id));
  if (!candidateIds.length) throw new KioraRuntimeError("GROWTH_CANDIDATE_NOT_COMPILABLE", 409);
  const { data: candidates, error } = await db.from("kiora_growth_candidates")
    .select("id,candidate_type,title,proposal,source_kind,priority,created_at,status,growth_scope,activation_instruction,rule_key,supersedes_candidate_id")
    .eq("owner_id", ownerId).in("id", candidateIds).eq("status", "accepted");
  if (error || (candidates || []).length !== candidateIds.length) {
    throw new KioraRuntimeError("ACCEPTED_GROWTH_CANDIDATE_REQUIRED", 409);
  }
  const byId = new Map((candidates || []).map((candidate) => [String(candidate.id), candidate]));
  let compilation;
  try {
    compilation = compileGrowthCandidates(candidateIds.map((id) => byId.get(id) as JsonObject));
  } catch (error) {
    const code = error instanceof Error ? error.message : "GROWTH_CANDIDATE_NOT_COMPILABLE";
    throw new KioraRuntimeError(code, 400);
  }
  const checksum = await sha256(canonicalGrowthCompilation(compilation));
  const { data, error: storeError } = await db.rpc("kiora_store_growth_compilation", {
    target_owner: ownerId,
    target_growth_version_id: growthVersionId,
    target_compiler_version: "phase4b-deterministic-v1",
    target_checksum: checksum,
    compiled_rule_records: compilation.rules,
    conflict_records: compilation.conflicts,
    compilation_status: compilation.status,
  });
  if (storeError) throw storeError;
  return {
    snapshot: data,
    status: compilation.status,
    checksum,
    rule_count: compilation.rules.length,
    enabled_rule_count: compilation.rules.filter((rule) => rule.enabled).length,
    conflict_count: compilation.unresolved_conflict_count,
  };
}

async function growthDiagnostics(db: SupabaseClient, ownerId: string): Promise<JsonObject> {
  const currentSettings = await settings(db, ownerId);
  const activeId = currentSettings.active_growth_version_id ? String(currentSettings.active_growth_version_id) : "";
  const [versionResult, snapshotResult, overlayResult, eventResult] = await Promise.all([
    activeId ? db.from("kiora_growth_versions").select("id,version,status,activated_at").eq("owner_id", ownerId).eq("id", activeId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    activeId ? db.from("kiora_compiled_growth_snapshots").select("id,status,compiler_version,checksum,conflict_count,compiled_at")
      .eq("owner_id", ownerId).eq("growth_version_id", activeId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("kiora_temporary_growth_overlays").select("id,scope,source_kind,created_at,expires_at,status")
      .eq("owner_id", ownerId).eq("status", "active").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(20),
    db.from("kiora_events").select("id,message_id,payload,occurred_at").eq("owner_id", ownerId)
      .eq("event_type", "GROWTH_CONTEXT_APPLIED").order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (versionResult.error || snapshotResult.error || overlayResult.error || eventResult.error) {
    throw new KioraRuntimeError("GROWTH_DIAGNOSTICS_READ_FAILED", 500);
  }
  const last = object(eventResult.data?.payload);
  return {
    active_growth_version: versionResult.data,
    compiled_snapshot: snapshotResult.data,
    applied_growth_rule_ids: array(last.applied_growth_rule_ids),
    temporary_overlay_ids: array(last.temporary_overlay_ids),
    growth_context_chars: Number(last.growth_context_chars) || 0,
    growth_context_tokens: Number(last.growth_context_tokens) || 0,
    skipped_rule_count: Number(last.skipped_rule_count) || 0,
    conflict_count: Number(last.conflict_count) || Number(snapshotResult.data?.conflict_count) || 0,
    active_temporary_overlays: overlayResult.data || [],
    last_application_event_id: eventResult.data?.id || null,
  };
}

async function shadowTest(db: SupabaseClient, ownerId: string, body: JsonObject): Promise<JsonObject> {
  const growthVersionId = uuid(body.growth_version_id, "INVALID_GROWTH_VERSION_ID");
  const currentSettings = await settings(db, ownerId);
  const flags = object(currentSettings.feature_flags);
  if (flags.shadow_testing_enabled !== true) throw new KioraRuntimeError("SHADOW_TESTING_DISABLED", 409);
  const selectedModelId = uuid(body.model_id || currentSettings.daily_brain_model_id, "INVALID_MODEL_ID");
  const [versionResult, snapshotResult, caseResult] = await Promise.all([
    db.from("kiora_growth_versions").select("id,status").eq("owner_id", ownerId).eq("id", growthVersionId).maybeSingle(),
    db.from("kiora_compiled_growth_snapshots").select("id,status,conflict_count").eq("owner_id", ownerId)
      .eq("growth_version_id", growthVersionId).eq("status", "valid").maybeSingle(),
    db.from("kiora_eval_cases").select("*").eq("owner_id", ownerId).eq("enabled", true).order("suite").order("name").limit(60),
  ]);
  if (versionResult.error || !versionResult.data) throw new KioraRuntimeError("GROWTH_VERSION_NOT_TESTABLE", 404);
  if (!["draft", "testing"].includes(String(versionResult.data.status))) throw new KioraRuntimeError("GROWTH_VERSION_NOT_TESTABLE", 409);
  if (snapshotResult.error || !snapshotResult.data || Number(snapshotResult.data.conflict_count) !== 0) {
    throw new KioraRuntimeError("VALID_GROWTH_SNAPSHOT_REQUIRED", 409);
  }
  if (caseResult.error || !(caseResult.data || []).length) throw new KioraRuntimeError("NO_EVAL_CASES", 409);
  const { data: compiledRules, error: rulesError } = await db.from("kiora_growth_rules")
    .select("id,scope,instruction,priority,evidence_strength,enabled").eq("owner_id", ownerId)
    .eq("snapshot_id", snapshotResult.data.id).eq("enabled", true).order("priority", { ascending: false });
  if (rulesError || !(compiledRules || []).length) throw new KioraRuntimeError("VALID_GROWTH_SNAPSHOT_REQUIRED", 409);
  const selectedModel = await model(db, ownerId, selectedModelId);
  if (selectedModel.status !== "active") throw new KioraRuntimeError("MODEL_NOT_FOUND", 404);
  const configuredMax = Number(selectedModel.config?.max_output_tokens) || 800;
  const shadowModel: ModelRecord = { ...selectedModel, config: { ...selectedModel.config, max_output_tokens: Math.min(1_000, Math.max(128, configuredMax)) } };
  const cases = (caseResult.data || []) as JsonObject[];
  const messages = cases.map((item) => shadowMessages({ compiled_growth_rules: compiledRules }, item));
  const projected = messages.reduce((sum, caseMessages) => {
    const inputTokens = Math.ceil(caseMessages.reduce((count, message) => count + message.content.length, 0) / 3);
    return sum + calculateCost(shadowModel, inputTokens, Number(shadowModel.config.max_output_tokens)).totalCost;
  }, 0);
  const currency = String(selectedModel.cost_config?.currency || "").toUpperCase() || null;
  const budget = await budgetSnapshot(db, ownerId, object(currentSettings.budget_config), currency);
  try {
    assertGrowthBudget(budget, projected);
  } catch (error) {
    if (!(error instanceof KioraRuntimeError) || error.code !== "GROWTH_BUDGET_DEFERRED") throw error;
    const { data, error: deferError } = await db.rpc("kiora_defer_shadow_test", {
      target_owner: ownerId, target_growth_version_id: growthVersionId,
      target_model_id: selectedModelId, defer_reason: error.code,
    });
    if (deferError) throw deferError;
    return { status: "deferred", shadow_test: data };
  }

  const { data: begun, error: beginError } = await db.rpc("kiora_begin_shadow_test", {
    target_owner: ownerId, target_growth_version_id: growthVersionId, target_model_id: selectedModelId,
  });
  if (beginError) throw beginError;
  const shadow = object(begun);
  const shadowId = String(shadow.id);
  const results: JsonObject[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    const evalCase = cases[index];
    let output = "";
    let passed = false;
    let notes = "provider_failed";
    let providerRequest: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let inputCost = 0;
    let outputCost = 0;
    let usageMetadata: JsonObject = { isolated_shadow: true, no_side_effects: true };
    try {
      const result = await adapterFor(shadowModel.adapter).complete({ model: shadowModel, messages: messages[index], outputFormat: "text" });
      const cost = calculateCost(shadowModel, result.inputTokens, result.outputTokens);
      output = result.content;
      ({ passed, notes } = evaluateShadowOutput(output, evalCase.expected_behavior, evalCase.prohibited_behavior));
      providerRequest = result.requestId;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      inputCost = cost.inputCost;
      outputCost = cost.outputCost;
      usageMetadata = { ...result.usageMetadata, isolated_shadow: true, no_side_effects: true, finish_reason: result.finishReason };
    } catch (error) {
      notes = error instanceof KioraRuntimeError ? error.code : "SHADOW_PROVIDER_FAILED";
    }
    const { data, error } = await db.rpc("kiora_record_shadow_case_result", {
      target_owner: ownerId, target_shadow_test_id: shadowId, target_case_id: evalCase.id,
      case_output: output, case_passed: passed, case_notes: notes,
      provider_request: providerRequest, used_input_tokens: inputTokens, used_output_tokens: outputTokens,
      used_input_cost: inputCost, used_output_cost: outputCost, used_currency: currency,
      used_metadata: usageMetadata,
    });
    if (error) throw error;
    results.push({ id: object(data).id, case_id: evalCase.id, suite: evalCase.suite, passed, notes });
  }
  const { data: completed, error: completeError } = await db.rpc("kiora_complete_shadow_test", {
    target_owner: ownerId, target_shadow_test_id: shadowId,
  });
  if (completeError) throw completeError;
  return { status: object(completed).status, shadow_test_id: shadowId, results };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  const headers = corsHeaders(origin);
  if (!headers) return jsonResponse(origin, { success: false, code: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return jsonResponse(origin, { success: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const { db, ownerId } = await requireKioraOwner(request);
    const body = object(await request.json());
    const action = text(body.action, 100);
    if (!ACTIONS.has(action)) throw new KioraRuntimeError("INVALID_ACTION", 400);
    let data: unknown;
    if (action === "status") {
      const currentSettings = await settings(db, ownerId);
      const [candidateCount, exampleCount, datasetCount, versionCount, shadowCount, snapshotCount, gateCount, overlayCount] = await Promise.all([
        db.from("kiora_growth_candidates").select("id", { count: "exact", head: true }).eq("owner_id", ownerId),
        db.from("kiora_training_examples").select("id", { count: "exact", head: true }).eq("owner_id", ownerId),
        db.from("kiora_datasets").select("id", { count: "exact", head: true }).eq("owner_id", ownerId),
        db.from("kiora_growth_versions").select("id", { count: "exact", head: true }).eq("owner_id", ownerId),
        db.from("kiora_shadow_tests").select("id", { count: "exact", head: true }).eq("owner_id", ownerId),
        db.from("kiora_compiled_growth_snapshots").select("id", { count: "exact", head: true }).eq("owner_id", ownerId),
        db.from("kiora_regression_gates").select("id", { count: "exact", head: true }).eq("owner_id", ownerId),
        db.from("kiora_temporary_growth_overlays").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("status", "active"),
      ]);
      data = { feature_flags: currentSettings.feature_flags, active_growth_version_id: currentSettings.active_growth_version_id,
        counts: { candidates: candidateCount.count || 0, training_examples: exampleCount.count || 0, datasets: datasetCount.count || 0,
          growth_versions: versionCount.count || 0, shadow_tests: shadowCount.count || 0,
          compiled_snapshots: snapshotCount.count || 0, regression_gates: gateCount.count || 0,
          active_overlays: overlayCount.count || 0 } };
    } else if (action === "collect_candidates") data = await collectCandidates(db, ownerId);
    else if (action === "collect_memory_evidence") data = await collectMemoryEvidence(db, ownerId, uuid(body.memory_evidence_id));
    else if (action === "collect_relationship_evidence") data = await collectRelationshipEvidence(db, ownerId, uuid(body.relationship_snapshot_id));
    else if (action === "review_candidate") {
      const result = await db.rpc("kiora_review_growth_candidate", { target_owner: ownerId, target_candidate_id: uuid(body.candidate_id), decision: text(body.decision, 40) });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "create_training_example") {
      const result = await db.rpc("kiora_create_training_example", {
        target_owner: ownerId, target_candidate_id: uuid(body.candidate_id), target_example_type: text(body.example_type, 40),
        example_context: object(body.context), example_input: text(body.input, 12_000),
        example_preferred_output: text(body.preferred_output), example_rejected_output: text(body.rejected_output) || null,
        example_rationale: text(body.rationale, 6_000), example_tags: array(body.tags).map(String).slice(0, 40),
      });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "review_training_example") {
      const result = await db.rpc("kiora_review_training_example", { target_owner: ownerId, target_example_id: uuid(body.training_example_id), decision: text(body.decision, 40) });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "create_dataset") {
      const result = await db.rpc("kiora_create_dataset_version", { target_owner: ownerId, dataset_name: text(body.name, 300),
        dataset_version: text(body.version, 120), training_example_ids: array(body.training_example_ids).map(String), dataset_notes: text(body.notes, 6_000) });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "freeze_dataset") {
      const result = await db.rpc("kiora_freeze_dataset_version", { target_owner: ownerId, target_dataset_id: uuid(body.dataset_id) });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "create_growth_version") {
      if (!growthChangesRespectProtectedBoundaries(body.intended_changes)) throw new KioraRuntimeError("GROWTH_PROTECTED_BOUNDARY", 400);
      const result = await db.rpc("kiora_create_growth_version", { target_owner: ownerId, growth_version: text(body.version, 120),
        based_on_id: body.based_on_version_id ? uuid(body.based_on_version_id) : null, target_dataset_id: uuid(body.dataset_version_id),
        accepted_candidate_ids: array(body.candidate_ids).map(String), change_plan: object(body.intended_changes) });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "start_testing") {
      const result = await db.rpc("kiora_start_growth_testing", { target_owner: ownerId, target_growth_version_id: uuid(body.growth_version_id) });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "prepare_candidate") {
      const instruction = safeGrowthInstruction(body.instruction);
      if (!instruction) throw new KioraRuntimeError("INVALID_GROWTH_ACTIVATION_METADATA", 400);
      const result = await db.rpc("kiora_prepare_growth_candidate", {
        target_owner: ownerId, target_candidate_id: uuid(body.candidate_id),
        target_scope: text(body.scope, 80), target_instruction: instruction,
        target_rule_key: text(body.rule_key, 160),
        target_supersedes_candidate_id: body.supersedes_candidate_id ? uuid(body.supersedes_candidate_id) : null,
      });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "compile_growth_version") {
      data = await compileGrowthVersion(db, ownerId, uuid(body.growth_version_id, "INVALID_GROWTH_VERSION_ID"));
    } else if (action === "upsert_eval_case") {
      const result = await db.rpc("kiora_upsert_eval_case", { target_owner: ownerId, target_case_id: body.case_id ? uuid(body.case_id) : null,
        case_suite: text(body.suite, 40), case_name: text(body.name, 500), case_input: object(body.input),
        expected: object(body.expected_behavior), prohibited: object(body.prohibited_behavior), case_severity: text(body.severity || "medium", 20),
        case_enabled: body.enabled !== false });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "set_shadow_testing") {
      const result = await db.rpc("kiora_set_shadow_testing", { target_owner: ownerId, enabled: body.enabled === true });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "run_shadow_test") data = await shadowTest(db, ownerId, body);
    else if (action === "create_regression_gate") {
      const result = await db.rpc("kiora_create_regression_gate", {
        target_owner: ownerId, target_shadow_test_id: uuid(body.shadow_test_id),
      });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "create_temporary_overlay") {
      const expiresAt = futureIso(body.expires_at);
      const instruction = safeGrowthInstruction(body.instruction);
      if (!instruction) throw new KioraRuntimeError("INVALID_GROWTH_OVERLAY", 400);
      const result = await db.rpc("kiora_create_temporary_growth_overlay", {
        target_owner: ownerId, target_scope: text(body.scope, 80), target_instruction: instruction,
        target_source_kind: text(body.source_kind || "temporary_preference", 80),
        target_source_message_id: body.source_message_id ? uuid(body.source_message_id) : null,
        target_expires_at: expiresAt,
      });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "dismiss_temporary_overlay") {
      const result = await db.rpc("kiora_dismiss_growth_overlay", { target_owner: ownerId, target_overlay_id: uuid(body.overlay_id) });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "promote_temporary_overlay") {
      const result = await db.rpc("kiora_promote_growth_overlay", { target_owner: ownerId, target_overlay_id: uuid(body.overlay_id) });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "record_growth_feedback") {
      const result = await db.rpc("kiora_record_growth_feedback", {
        target_owner: ownerId,
        target_growth_rule_id: body.growth_rule_id ? uuid(body.growth_rule_id) : null,
        target_overlay_id: body.overlay_id ? uuid(body.overlay_id) : null,
        target_source_message_id: body.source_message_id ? uuid(body.source_message_id) : null,
        target_feedback_id: body.feedback_id ? uuid(body.feedback_id) : null,
        target_evidence_type: text(body.evidence_type, 40), target_note: text(body.note, 2_000),
      });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "growth_diagnostics") data = await growthDiagnostics(db, ownerId);
    else if (action === "promote_growth_version") {
      const result = await db.rpc("kiora_activate_growth_version", {
        target_owner: ownerId, target_growth_version_id: uuid(body.growth_version_id),
        target_regression_gate_id: uuid(body.regression_gate_id), activation_reason: text(body.reason, 2_000),
        allow_warnings: body.allow_warnings === true,
      });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "reject_growth_version") {
      const result = await db.rpc("kiora_reject_growth_version", { target_owner: ownerId, target_growth_version_id: uuid(body.growth_version_id), rejection_reason: text(body.reason, 2_000) });
      if (result.error) throw result.error; data = result.data;
    } else if (action === "retire_growth_version") {
      const result = await db.rpc("kiora_retire_growth_version_v2", {
        target_owner: ownerId, target_growth_version_id: uuid(body.growth_version_id), retirement_reason: text(body.reason, 2_000),
      });
      if (result.error) throw result.error; data = result.data;
    } else {
      const result = await db.rpc("kiora_rollback_growth_version_v2", {
        target_owner: ownerId, rollback_reason: text(body.reason || "OWNER requested rollback", 2_000),
      });
      if (result.error) throw result.error; data = result.data;
    }
    return jsonResponse(origin, { success: true, data });
  } catch (error) {
    const normalized = runtimeError(error);
    if (normalized.status >= 500) console.error("KIORA_GROWTH_FAILED", normalized.code);
    else console.warn("KIORA_GROWTH_REJECTED", normalized.code);
    return jsonResponse(origin, { success: false, code: normalized.code }, normalized.status);
  }
});
