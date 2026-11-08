import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  candidateFromFeedback,
  evaluateShadowOutput,
  growthChangesRespectProtectedBoundaries,
  repeatedFeedbackCandidates,
  shadowMessages,
} from "../../supabase/functions/kiora-growth/growth-policy.ts";

const root = new URL("../../", import.meta.url);
const migration = await readFile(new URL("supabase-kiora-phase4a-migration.sql", root), "utf8");
const runtime = await readFile(new URL("supabase/functions/kiora-growth/index.ts", root), "utf8");
const reflection = await readFile(new URL("supabase/functions/kiora-runtime/reflection.ts", root), "utf8");
const budget = await readFile(new URL("supabase/functions/kiora-runtime/budget-manager.ts", root), "utf8");
const dailyRuntime = await readFile(new URL("supabase/functions/kiora-runtime/index.ts", root), "utf8");
const growthContext = await readFile(new URL("supabase/functions/kiora-runtime/growth-context.ts", root), "utf8");

// Explicit correction -> candidate.
const correction = candidateFromFeedback({
  id: "11111111-1111-4111-8111-111111111111",
  message_id: "22222222-2222-4222-8222-222222222222",
  feedback_type: "correction",
  content: "不是这样，请以后先确认事实。",
});
assert.equal(correction?.candidateType, "correction");
assert.equal(correction?.sourceKind, "correction");
assert.equal(correction?.evidenceRefs.length, 2);

// A repeated stored feedback pattern -> candidate with multiple evidence refs.
const repeated = repeatedFeedbackCandidates([
  { id: "a", message_id: "m1", feedback_type: "preference", content: "以后请简洁回答" },
  { id: "b", message_id: "m2", feedback_type: "preference", content: "以后请简洁回答" },
]);
assert.equal(repeated.length, 1);
assert.equal(repeated[0].sourceKind, "repeated_conversation_pattern");
assert.ok(repeated[0].evidenceRefs.length >= 4);
assert.match(migration, /count\(distinct value\)[\s\S]*REPEATED_PATTERN_EVIDENCE_REQUIRED/);

// One ordinary chat is not explicit feedback and Reflection requires two message IDs.
assert.equal(candidateFromFeedback({ id: "x", feedback_type: "other", content: "普通聊天内容" }), null);
assert.match(reflection, /!feedback && evidenceMessageIds\.length < 2/);
assert.match(reflection, /Never derive them from Research, Knowledge, webpages, or source material/);
assert.match(migration, /kiora_growth_candidates_compat/);

// Research/Knowledge is not an allowed candidate source and training requires an accepted candidate.
assert.doesNotMatch(migration, /candidate_source_kind not in \([^)]*research/i);
assert.match(migration, /ACCEPTED_GROWTH_CANDIDATE_REQUIRED/);
assert.match(migration, /candidate_row\.source_kind not in \('explicit_feedback','correction','reflection','memory_evidence','relationship_evidence','repeated_conversation_pattern'\)/);

// Candidate -> Training Example and dataset membership are explicit service RPC steps.
assert.match(migration, /create or replace function public\.kiora_create_training_example/);
assert.match(migration, /source_candidate_id,growth_candidate_id,example_type/);
assert.match(migration, /create table if not exists public\.kiora_dataset_examples/);

// Frozen datasets cannot be changed in place; modifications require another version.
assert.match(migration, /create or replace function public\.kiora_guard_frozen_dataset/);
assert.match(migration, /raise exception 'DATASET_FROZEN'/);
assert.match(migration, /kiora_dataset_examples_guard/);

// Growth Version draft -> testing.
assert.match(migration, /set status='testing'[\s\S]*status='draft'/);

// Protected Phase 0–3 boundaries are checked recursively and in Runtime.
assert.equal(growthChangesRespectProtectedBoundaries({ response_style: { concise: true } }), true);
assert.equal(growthChangesRespectProtectedBoundaries({ nested: { memory: { rewrite: true } } }), false);
assert.match(migration, /kiora_growth_plan_has_protected_key/);

// Shadow output is deterministic case-level pass/fail with no subjective total score.
assert.deepEqual(evaluateShadowOutput("A careful answer", { nonempty: true }, { must_not_include: ["executed tool"] }), {
  passed: true,
  notes: "case_passed",
});
assert.equal(evaluateShadowOutput("I executed tool", { nonempty: true }, { must_not_include: ["executed tool"] }).passed, false);
const shadowPrompt = shadowMessages({ response_style: "concise" }, { suite: "tool", name: "isolated", input: { prompt: "test" } });
assert.match(shadowPrompt[0].content, /Do not write Memory, Relationship, Knowledge, Core, messages, or tools/);

// Shadow execution never writes normal conversation, Memory, Knowledge or Relationship state.
const shadowRuntime = runtime.slice(runtime.indexOf("async function shadowTest"), runtime.indexOf("Deno.serve"));
assert.doesNotMatch(shadowRuntime, /kiora_complete_turn|kiora_messages|kiora_memories|kiora_knowledge|kiora_relationship_snapshots/);
assert.match(shadowRuntime, /kiora_record_shadow_case_result/);
assert.match(migration, /values\(target_owner,run_row\.id,'shadow_test'/);

// A failed Shadow Test updates only evaluation/shadow records; active version remains untouched.
const completeShadow = migration.slice(
  migration.indexOf("create or replace function public.kiora_complete_shadow_test"),
  migration.indexOf("create or replace function public.kiora_promote_growth_version"),
);
assert.doesNotMatch(completeShadow, /update public\.kiora_settings|update public\.kiora_growth_versions/);
assert.match(completeShadow, /final_status:=case when result_count=expected_count and failed_count=0 then 'passed' else 'failed' end/);

// Promotion has one active version, is explicit, requires a passing Shadow Test, and rollback is recorded.
assert.match(migration, /create unique index if not exists kiora_one_active_growth_version_uidx/);
assert.match(migration, /PASSING_SHADOW_TEST_REQUIRED/);
assert.match(migration, /create or replace function public\.kiora_rollback_growth_version/);
assert.match(migration, /GROWTH_VERSION_ROLLED_BACK/);
assert.match(migration, /'auto_promote_enabled',false/);
assert.match(dailyRuntime, /loadGrowthRuntime\(/);
assert.match(growthContext, /growthRuntimePrompt/);
assert.doesNotMatch(growthContext, /JSON\.stringify\(value\.intended_changes/);

// Growth uses a lower-priority reserve/soft-limit and defers before model calls when insufficient.
assert.match(budget, /export function assertGrowthBudget/);
assert.match(budget, /GROWTH_BUDGET_DEFERRED/);
assert.ok(runtime.indexOf("assertGrowthBudget(budget, projected)") < runtime.indexOf("kiora_begin_shadow_test"));
assert.match(runtime, /kiora_defer_shadow_test/);

// Extending Usage Ledger must preserve every Phase 3 category.
for (const category of ["search", "knowledge_extraction", "research_reflection"]) {
  assert.match(migration, new RegExp(`'${category}'`));
}

// OWNER isolation: JWT + is_site_owner is reused, new tables are read-only to OWNER browsers, mutations are service_role only.
assert.match(runtime, /requireKioraOwner\(request\)/);
assert.match(migration, /enable row level security/);
assert.match(migration, /public\.is_site_owner\(\)/);
assert.match(migration, /revoke all on function public\.kiora_create_growth_candidate[\s\S]*from public,anon,authenticated/);
assert.match(migration, /grant execute on function public\.kiora_create_growth_candidate[\s\S]*to service_role/);

// All six suites and Phase 4A flags exist; Shadow is off until explicitly enabled.
for (const suite of ["personality", "relationship", "memory", "hallucination", "research", "tool"]) {
  assert.match(migration, new RegExp(`'${suite}'`));
}
for (const flag of [
  "growth_candidates_enabled", "training_examples_enabled", "dataset_versions_enabled",
  "growth_versions_enabled", "evaluation_enabled", "shadow_testing_enabled",
]) assert.match(migration, new RegExp(`'${flag}'`));
assert.match(migration, /'shadow_testing_enabled',false/);

// Phase 4B / training / Agency boundaries: no provider training endpoint and no tool execution path.
assert.doesNotMatch(runtime, /fine[_-]?tune|LoRA|scheduled|tool_call|agency/i);
assert.doesNotMatch(migration, /fine[_-]?tune|LoRA/i);

console.log("Phase 4A Growth Foundation checks passed.");
