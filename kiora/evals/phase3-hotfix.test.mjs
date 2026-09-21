import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const router = await import(new URL("supabase/functions/kiora-runtime/research-router.ts", root).href);
const diagnostics = await import(new URL("supabase/functions/kiora-runtime/research-diagnostics.ts", root).href);
const migration = await readFile(new URL("supabase-kiora-phase3-hotfix-migration.sql", root), "utf8");
const runtime = await readFile(new URL("supabase/functions/kiora-runtime/research.ts", root), "utf8");
const index = await readFile(new URL("supabase/functions/kiora-runtime/index.ts", root), "utf8");

function sourceIdentity(owner, source) {
  return `${owner}\n${source.url}\n${source.content_hash ?? "<NULL>"}`;
}
function upsert(store, owner, source) {
  const key = sourceIdentity(owner, source);
  const existing = store.get(key);
  store.set(key, existing ? { ...existing, ...source, id: existing.id } : { ...source, id: `S${store.size + 1}` });
  return store.get(key);
}
function linkSource(links, runId, source) {
  const key = `${runId}\n${source.id}`;
  links.set(key, { runId, sourceId: source.id });
}

const owner = "owner-1";
const store = new Map();
const a1 = upsert(store, owner, { url: "https://example.test/a", canonical_url: "https://example.test/a", content_hash: "h1" });
const a2 = upsert(store, owner, { url: "https://example.test/a", canonical_url: "https://example.test/a", content_hash: "h1" });
assert.equal(a1.id, a2.id, "A: same URL/hash must reuse Source");
assert.equal(store.size, 1);

upsert(store, owner, { url: "https://example.test/a", canonical_url: "https://example.test/a", content_hash: "h2" });
assert.equal(store.size, 2, "B: changed content hash must create a new Source version");

const c = upsert(store, owner, { url: "https://example.test/a", canonical_url: "https://canonical.test/new", content_hash: "h1" });
assert.equal(c.id, a1.id, "C: canonical URL changes must not change Source identity");
assert.equal(store.size, 2);
assert.equal(c.canonical_url, "https://canonical.test/new");

upsert(store, owner, { url: "https://example.test/a", canonical_url: "https://canonical.test/new", content_hash: "h1" });
assert.equal(store.size, 2, "D: a repeated run must not create a duplicate Source");
const provenanceLinks = new Map();
linkSource(provenanceLinks, "run-1", a1);
linkSource(provenanceLinks, "run-2", a2);
assert.equal(provenanceLinks.size, 2, "D: repeated research must retain one Source link for every run");
assert.equal(new Set([...provenanceLinks.values()].map((link) => link.sourceId)).size, 1, "D: both run links reuse the same Source");

assert.match(migration, /url=identity_url and content_hash is not distinct from identity_hash/i);
assert.doesNotMatch(migration, /coalesce\(canonical_url,url\)/i);
assert.match(migration, /pg_advisory_xact_lock/i);
assert.match(migration, /exception when unique_violation/i);
assert.doesNotMatch(migration, /drop\s+(?:table|constraint).*kiora_sources/i);
assert.match(migration, /create table if not exists public\.kiora_research_run_sources/i);
assert.match(migration, /unique\(owner_id,research_run_id,source_id\)/i);
assert.match(migration, /perform 1 from public\.kiora_research_runs where owner_id=target_owner and id=target_research_run_id/i);
assert.match(migration, /insert into public\.kiora_research_run_sources[\s\S]*on conflict\(owner_id,research_run_id,source_id\) do update/i);
const reusedSourceUpdate = migration.match(/else\s+update public\.kiora_sources set([\s\S]*?)where id=source_id;/i)?.[1] || "";
assert.doesNotMatch(reusedSourceUpdate, /research_run_id\s*=/i, "Reusing a Source must not overwrite its original research_run_id");
assert.match(index, /sources:kiora_research_run_sources/, "Research details must read per-run Source links");

assert.equal(diagnostics.shouldRetryZeroClaims(0, 2, false), true, "E: first zero-claim pass gets one retry");
assert.equal(diagnostics.shouldRetryZeroClaims(0, 2, true), false, "F: retry may not recurse");
const sourceBody = "DeepSeek provides official API documentation for developers.";
const verbatimEvidence = "official API documentation for developers";
assert.equal(diagnostics.evidenceIsGrounded(sourceBody, verbatimEvidence), true, "F: verbatim fallback evidence passes grounding");
assert.equal(diagnostics.researchOutcomeStatus(1, 1), "completed", "F: a grounded fallback claim completes research");
assert.equal(diagnostics.evidenceIsGrounded(sourceBody, "a rewritten claim with no verbatim support"), false, "F: retry does not weaken grounding");
assert.match(runtime, /totalInputTokens \+= fallbackResult\.inputTokens/);
assert.match(runtime, /totalOutputCost \+= fallbackCost\.outputCost/);
assert.match(runtime, /assertResearchBudget\([\s\S]*projectedModelCost\(fallbackModel, fallbackMessages\)/);
assert.equal(diagnostics.researchOutcomeStatus(2, 0), "no_grounded_claims", "G: ungrounded fallback stays zero-claim");
assert.equal(diagnostics.researchOutcomeStatus(0, 0), "no_reliable_sources");

const redacted = diagnostics.safeResearchErrorDetails(new Error("Bearer secret-token eyJaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbb.cccccccccc"));
assert.doesNotMatch(String(redacted.message), /secret-token|eyJaaaaaaaa/);
assert.match(index, /catch \(researchError\)[\s\S]*External research could not be completed[\s\S]*kiora_fail_research/);
assert.doesNotMatch(index, /researchNotice = `RESEARCH_STATUS:/);

const unrelated = router.routeResearch("帮我联网搜索 DeepSeek 官网", {
  visible: { title: "当前游戏标题", entity_type: "game", entity_id: "42" },
});
assert.doesNotMatch(unrelated.query, /当前游戏标题/, "I: unrelated explicit search must exclude current page entity");
assert.equal(unrelated.entity.canonical_name, null);

const deictic = router.routeResearch("帮我查一下这个游戏的官网", {
  visible: { title: "当前游戏标题", entity_type: "game", entity_id: "42" },
});
assert.match(deictic.query, /当前游戏标题/, "J: deictic search must include current page entity");
assert.equal(deictic.entity.canonical_name, "当前游戏标题");

console.log("Phase 3 hotfix checks A-J plus per-run Source provenance passed.");
