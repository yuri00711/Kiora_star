import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const structured = await import(new URL("supabase/functions/kiora-runtime/structured-output.ts", root).href);
const types = await readFile(new URL("supabase/functions/kiora-runtime/types.ts", root), "utf8");
const adapter = await readFile(new URL("supabase/functions/kiora-runtime/brain-adapters.ts", root), "utf8");
const research = await readFile(new URL("supabase/functions/kiora-runtime/research.ts", root), "utf8");
const reflection = await readFile(new URL("supabase/functions/kiora-runtime/reflection.ts", root), "utf8");
const index = await readFile(new URL("supabase/functions/kiora-runtime/index.ts", root), "utf8");

function result(content, finishReason = "stop") {
  return {
    content,
    inputTokens: 12,
    outputTokens: 8,
    requestId: "request-test-1",
    providerModel: "deepseek-chat",
    finishReason,
    usageMetadata: {},
  };
}

const originalError = console.error;
const diagnosticLogs = [];
console.error = (...args) => diagnosticLogs.push(args);
try {
  assert.deepEqual(
    structured.parseStructuredJson(result('{"claims":[],"open_questions":[]}'), "test"),
    { claims: [], open_questions: [] },
    "valid json_object output must parse",
  );

  assert.throws(
    () => structured.parseStructuredJson(result('```json\n{"claims":[]}\n```'), "test"),
    (error) => error instanceof structured.StructuredOutputError && error.code === "STRUCTURED_OUTPUT_INVALID",
    "markdown fences are no longer a supported normal parsing path",
  );

  assert.throws(
    () => structured.parseStructuredJson(result('{"claims":[', "length"), "test"),
    (error) => error instanceof structured.StructuredOutputError && error.code === "STRUCTURED_OUTPUT_TRUNCATED",
  );
  assert.throws(
    () => structured.parseStructuredJson(result('{bad json}'), "test"),
    (error) => error instanceof structured.StructuredOutputError && error.code === "STRUCTURED_OUTPUT_INVALID",
  );
  assert.throws(
    () => structured.parseStructuredJson(result(""), "test"),
    (error) => error instanceof structured.StructuredOutputError && error.code === "STRUCTURED_OUTPUT_INVALID",
  );
} finally {
  console.error = originalError;
}

assert.ok(diagnosticLogs.some(([event]) => event === "STRUCTURED_OUTPUT_TRUNCATED"));
assert.ok(diagnosticLogs.some(([event]) => event === "STRUCTURED_OUTPUT_INVALID"));
for (const [, details] of diagnosticLogs) {
  assert.equal(typeof details.content_length, "number");
  assert.ok("finish_reason" in details);
  assert.ok("leading_structure" in details);
  assert.ok("trailing_structure" in details);
  assert.ok("provider_model" in details);
  assert.ok("request_id" in details);
  assert.equal(JSON.stringify(details).includes("bad json"), false, "diagnostics must not log model response text");
}

assert.match(types, /outputFormat\?:\s*"text"\s*\|\s*"json_object"/);
assert.match(types, /finishReason:\s*string\s*\|\s*null/);
assert.match(adapter, /outputFormat\s*=\s*request\.outputFormat\s*\|\|\s*"text"/);
assert.match(adapter, /response_format:\s*\{\s*type:\s*"json_object"\s*\}/);
assert.match(adapter, /finishReason,/);

assert.match(index, /messages:\s*brainMessages,\s*outputFormat:\s*"text"/s, "daily chat remains text mode");
assert.match(research, /outputFormat:\s*"json_object"/);
assert.match(reflection, /outputFormat:\s*"json_object"/);
assert.match(research, /Return JSON only:/);
assert.match(reflection, /Return JSON only/);
assert.doesNotMatch(research, /replace\(\/\^```/, "research must not depend on markdown stripping");
assert.doesNotMatch(reflection, /lastIndexOf\("}"\)/, "reflection must not salvage arbitrary JSON substrings");

assert.match(research, /error\.code === "STRUCTURED_OUTPUT_TRUNCATED"/);
assert.match(research, /structuredRetryAttempted = true/);
assert.match(research, /max_output_tokens:\s*retryLimit/);
assert.match(research, /Return at most 6 claims and 2 open_questions/);
assert.match(index, /RESEARCH_STATUS: EXTRACTION_FAILED\. Sources were found and read/);

console.log("Phase 3 structured JSON mode, diagnostics, and bounded truncation checks passed.");
