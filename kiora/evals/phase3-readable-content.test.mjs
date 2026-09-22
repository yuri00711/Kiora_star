import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const material = await import(new URL("supabase/functions/kiora-runtime/research-material.ts", root).href);
const safeFetch = await readFile(new URL("supabase/functions/kiora-runtime/safe-fetch.ts", root), "utf8");
const adapters = await readFile(new URL("supabase/functions/kiora-runtime/research-adapters.ts", root), "utf8");
const runtime = await readFile(new URL("supabase/functions/kiora-runtime/research.ts", root), "utf8");

// HTTP 200 plus readable body: direct page text always wins over provider material.
const direct = material.selectResearchMaterial({
  directText: "公式ページの正常な本文です。DeepSeek API documentation is available. 🪐",
  providerRawContent: "provider raw fallback",
  providerSnippet: "snippet fallback",
});
assert.equal(direct.evidenceKind, "direct_body");
assert.equal(direct.snippetOnly, false);
assert.match(direct.text, /正常な本文/);
assert.equal(material.readableBodyIsUsable(direct.text), true);
assert.equal(material.readableBodyIsUsable("Please enable JavaScript to continue"), false);
assert.equal(material.readableBodyIsUsable(" \n\t\u0000 "), false);

// HTTP 200 JS shell / empty readable body: provider raw content is the first fallback.
const providerRaw = material.selectResearchMaterial({
  directText: " \n\t\u0000 ",
  providerRawContent: "検索プロバイダーが抽出したページ本文です。😀",
  providerSnippet: "short snippet",
});
assert.equal(providerRaw.evidenceKind, "provider_raw");
assert.equal(providerRaw.providerExtracted, true);
assert.equal(providerRaw.snippetOnly, false);

// Empty body and raw content: Tavily result.content remains usable only as a labelled snippet.
const snippet = material.selectResearchMaterial({
  directText: "",
  providerRawContent: null,
  providerSnippet: "限定された検索スニペットの内容です。",
});
assert.equal(snippet.evidenceKind, "provider_snippet");
assert.equal(snippet.snippetOnly, true);

// No text anywhere: no empty chunk and no extraction/retry eligibility.
const empty = material.selectResearchMaterial({
  directText: " \u0000 ",
  providerRawContent: "\u0001\u0002",
  providerSnippet: "  ",
});
assert.equal(empty, null);
assert.deepEqual(material.chunkReadableMaterial(" \u0000 "), []);
const emptyDiagnostics = material.researchMaterialDiagnostics(3, []);
assert.equal(emptyDiagnostics.extraction_source_count, 0);
assert.equal(emptyDiagnostics.extraction_text_chars, 0);
assert.equal(material.hasExtractionMaterial(emptyDiagnostics), false);

const diagnostics = material.researchMaterialDiagnostics(3, [
  { ref: "S1", text: direct.text, evidence_kind: direct.evidenceKind },
  { ref: "S2", text: providerRaw.text, evidence_kind: providerRaw.evidenceKind },
  { ref: "S3", text: snippet.text, evidence_kind: snippet.evidenceKind },
]);
assert.deepEqual(
  {
    discovered_source_count: diagnostics.discovered_source_count,
    direct_fetch_success_count: diagnostics.direct_fetch_success_count,
    readable_source_count: diagnostics.readable_source_count,
    provider_fallback_source_count: diagnostics.provider_fallback_source_count,
    extraction_source_count: diagnostics.extraction_source_count,
  },
  {
    discovered_source_count: 3,
    direct_fetch_success_count: 1,
    readable_source_count: 3,
    provider_fallback_source_count: 2,
    extraction_source_count: 3,
  },
);
assert.ok(diagnostics.direct_text_chars > 0);
assert.ok(diagnostics.provider_fallback_text_chars > 0);
assert.equal(
  diagnostics.extraction_text_chars,
  diagnostics.direct_text_chars + diagnostics.provider_fallback_text_chars,
);

// PostgreSQL-safe Unicode behavior remains shared by direct, raw, and snippet material.
const unicode = material.normalizeReadableText("中\u0000文 日本語 😀 A\ud800B\udfffC\u0002D");
assert.equal(unicode, "中文 日本語 😀 A�B�CD");
assert.doesNotMatch(JSON.stringify(unicode), /\\u0000|\\ud800|\\udfff/i);

assert.match(safeFetch, /if \(!readableBodyIsUsable\(text, minimumReadableChars\)\)/);
assert.match(safeFetch, /RESEARCH_READABLE_TEXT_INSUFFICIENT[\s\S]*RESEARCH_READABLE_TEXT_EMPTY/);
assert.match(safeFetch, /readable_char_count:\s*text\.length/);
assert.match(adapters, /include_raw_content:\s*"text"/);
assert.match(adapters, /rawContent:\s*sanitizePostgresText\(candidate\.raw_content\)/);
assert.doesNotMatch(runtime, /\|\|\s*\[""\]/, "runtime must never manufacture an empty source chunk");
assert.match(runtime, /if \(!hasExtractionMaterial\(materialDiagnostics\) \|\| !sourceMaterial\.length\)/);
assert.ok(
  runtime.indexOf("if (!hasExtractionMaterial(materialDiagnostics)") < runtime.indexOf("const messages = ["),
  "no-readable-content must return before the extraction Brain is invoked",
);
assert.match(runtime, /no_readable_content/);
assert.match(runtime, /confidence:\s*snippetOnlyEvidence \? Math\.min\(0\.45,/);

console.log("Phase 3 readable-content fallback, diagnostics, and no-token-waste checks passed.");
