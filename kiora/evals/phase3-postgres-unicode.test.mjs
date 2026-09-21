import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const sanitizer = await import(new URL("supabase/functions/kiora-runtime/postgres-sanitize.ts", root).href);
const runtime = await readFile(new URL("supabase/functions/kiora-runtime/research.ts", root), "utf8");
const safeFetch = await readFile(new URL("supabase/functions/kiora-runtime/safe-fetch.ts", root), "utf8");
const adapters = await readFile(new URL("supabase/functions/kiora-runtime/research-adapters.ts", root), "utf8");

function assertPostgresSafeString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    assert.ok(code > 0x1f && code !== 0x7f, `unsafe control U+${code.toString(16).padStart(4, "0")}`);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, "unpaired high surrogate");
      index += 1;
    } else {
      assert.ok(code < 0xdc00 || code > 0xdfff, "unpaired low surrogate");
    }
  }
}

function walk(value) {
  if (typeof value === "string") return assertPostgresSafeString(value);
  if (Array.isArray(value)) return value.forEach(walk);
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertPostgresSafeString(key);
      walk(item);
    }
  }
}

const dirtyRecords = [{
  ref: "S1\u0000",
  title: "中文・日本語 😀\u0000 title",
  relevant_excerpt: "A\u0000B\ud800C\udc00D😀中文日本語\u0001E\tF\nG\rH\u007fI",
  metadata: {
    "bad\u0000key": "snippet\u0002with\ud800controls",
    nested: ["正常な文章", "emoji 🪐✨", "low\udfff-surrogate"],
  },
}];

const cleanRecords = sanitizer.sanitizeSourceRecordsForRpc(dirtyRecords);
walk(cleanRecords);
assert.equal(cleanRecords[0].ref, "S1");
assert.equal(cleanRecords[0].title, "中文・日本語 😀 title");
assert.equal(cleanRecords[0].relevant_excerpt, "AB�C�D😀中文日本語E F G HI");
assert.equal(cleanRecords[0].metadata["badkey"], "snippetwith�controls");
assert.equal(cleanRecords[0].metadata.nested[0], "正常な文章");
assert.equal(cleanRecords[0].metadata.nested[1], "emoji 🪐✨");
assert.equal(cleanRecords[0].metadata.nested[2], "low�-surrogate");

const serialized = JSON.stringify(cleanRecords);
assert.doesNotMatch(serialized, /\\u0000/i);
assert.doesNotMatch(serialized, /\\ud800|\\udfff/i);
assert.deepEqual(JSON.parse(serialized), cleanRecords);

const rpcSanitizerCalls = runtime.match(/source_records:\s*sanitizeSourceRecordsForRpc\(/g) || [];
assert.equal(rpcSanitizerCalls.length, 3, "stage, no-source completion, and normal completion must sanitize source_records");
assert.match(safeFetch, /return sanitizePostgresText\(/);
assert.match(adapters, /title: sanitizePostgresText\(/);
assert.match(adapters, /snippet: sanitizePostgresText\(/);

console.log("Phase 3 PostgreSQL-safe Unicode source-record checks passed.");
