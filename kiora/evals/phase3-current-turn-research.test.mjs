import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildResearchOutcome,
  composeResearchWorldContext,
  currentTurnGroundedClaims,
  researchCurrentTurnPrompt,
  successfulFallbackSource,
} from "../../supabase/functions/kiora-runtime/research-current-turn.ts";

const root = new URL("../../", import.meta.url);
const researchRuntime = await readFile(new URL("supabase/functions/kiora-runtime/research.ts", root), "utf8");
const runtimeIndex = await readFile(new URL("supabase/functions/kiora-runtime/index.ts", root), "utf8");

assert.match(researchRuntime, /return buildResearchOutcome\(status, fetched, claims, completed\.data\)/,
  "runResearch must return the verified claims from this run");
assert.match(runtimeIndex, /groundedClaims:\s*outcome\.groundedClaims/,
  "index must pass current-run claims directly to the current-turn prompt");
assert.match(runtimeIndex, /currentTurnResearch:\s*currentTurnResearchContext/,
  "worldContext must include current-turn research independently of Knowledge retrieval");

const verifiedClaim = (summary = "The page confirms the requested fact.") => ({
  claim: "The requested fact is confirmed by the source.",
  summary,
  confidence: 0.91,
  source_support: [{ ref: "S1", excerpt: "verbatim evidence that must not enter Daily Brain" }],
});

test("Case A: direct-body research puts grounded claims into current-turn context", () => {
  const outcome = buildResearchOutcome("completed", [{
    fetch_status: "fetched",
    title: "Direct page",
    url: "https://example.com/article",
    canonical_url: "https://example.com/article",
    metadata: { snippet_only: false },
    reliability: { claim_relevance: "requested page" },
    evidence_kind: "direct_body",
  }], [verifiedClaim()], { research_run_id: "run-a" });
  const prompt = researchCurrentTurnPrompt({
    status: outcome.status,
    requestedUrls: ["https://example.com/article"],
    groundedClaims: outcome.groundedClaims,
  });
  assert.equal(outcome.sources.length, 1);
  assert.equal(outcome.sources[0].evidence_kind, "direct_body");
  assert.match(prompt, /RESEARCH_STATUS: COMPLETED/);
  assert.match(prompt, /The page confirms the requested fact/);
  assert.match(prompt, /https:\/\/example\.com\/article/);
  assert.doesNotMatch(JSON.stringify(outcome.groundedClaims), /verbatim evidence/);
});

test("Case B: provider-extract success is fetched, clears fetch_error, and reaches Daily Brain", () => {
  const source = successfulFallbackSource({
    fetch_status: "failed",
    fetch_error: "RESEARCH_URL_BLOCKED",
    metadata: {
      retrieval_method: "provider_extract",
      provider: "tavily",
      direct_fetch_error: "RESEARCH_URL_BLOCKED",
    },
  }, "RESEARCH_URL_BLOCKED", "dns_resolved_nonpublic");
  assert.equal(source.fetch_status, "fetched");
  assert.equal(source.fetch_error, null);
  assert.deepEqual(source.metadata, {
    retrieval_method: "provider_extract",
    provider: "tavily",
    direct_fetch_status: "failed",
    direct_fetch_failure: "RESEARCH_URL_BLOCKED",
    direct_block_reason: "dns_resolved_nonpublic",
  });

  const prompt = researchCurrentTurnPrompt({
    status: "completed",
    requestedUrls: ["https://ayakasigohan-edia.com/"],
    groundedClaims: currentTurnGroundedClaims([verifiedClaim("Tavily Extract supplied a grounded fact.")]),
  });
  assert.match(prompt, /Tavily Extract supplied a grounded fact/);
  assert.match(prompt, /Do not claim that the webpage was unavailable/);
});

test("Case C: empty historical Knowledge does not remove same-turn grounded claims", () => {
  const emptyKnowledgePrompt = "RELEVANT_KNOWLEDGE: none.";
  const currentTurn = researchCurrentTurnPrompt({
    status: "completed",
    groundedClaims: currentTurnGroundedClaims([verifiedClaim("Same-turn fact remains available.")]),
  });
  const worldContext = composeResearchWorldContext({
    historicalKnowledge: emptyKnowledgePrompt,
    currentTurnResearch: currentTurn,
  });
  assert.match(worldContext, /RELEVANT_KNOWLEDGE: none/);
  assert.match(worldContext, /Same-turn fact remains available/);
});

test("Case D: a genuinely failed research run cannot produce a completed current-turn prompt", () => {
  const prompt = researchCurrentTurnPrompt({
    status: "failed",
    requestedUrls: ["https://example.com/"],
    groundedClaims: currentTurnGroundedClaims([verifiedClaim()]),
  });
  assert.equal(prompt, "");
});
