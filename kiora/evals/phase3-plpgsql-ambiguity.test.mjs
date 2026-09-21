import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const sql = await readFile(new URL("supabase-kiora-phase3-plpgsql-ambiguity-hotfix.sql", root), "utf8");
const functionMatches = [...sql.matchAll(/create or replace function\s+public\.(kiora_(?:upsert_research_source|stage_research_sources|complete_research))\([\s\S]*?end; \$\$;/gi)];
assert.equal(functionMatches.length, 3, "hotfix must replace exactly the three required functions");

for (const match of functionMatches) {
  const [definition, functionName] = match;
  const declarations = definition.match(/declare([\s\S]*?)\nbegin/i)?.[1] || "";
  const localIds = [...declarations.matchAll(/\b([a-z_][a-z0-9_]*_id)\s+(?:uuid|text|integer|bigint|numeric)\b/gi)]
    .map((item) => item[1].toLowerCase());
  assert.ok(localIds.every((name) => name.startsWith("v_")), `${functionName}: every scalar local ID must use v_ prefix`);

  for (const conflict of definition.matchAll(/on conflict\s*\(([^)]+)\)/gi)) {
    const conflictColumns = conflict[1].split(",").map((column) => column.trim().toLowerCase());
    const overlap = conflictColumns.filter((column) => localIds.includes(column));
    assert.deepEqual(overlap, [], `${functionName}: conflict target must not overlap local variable names`);
  }
}

assert.match(sql, /declare v_source_id uuid/i);
assert.match(sql, /values\(\s*target_owner,target_research_run_id,v_source_id,/i);
assert.match(sql, /on conflict\(owner_id,research_run_id,source_id\) do update/i);
assert.match(sql, /declare run_row[^;]+; source_item jsonb; v_source_id uuid;/i);
assert.match(sql, /v_source_id:=public\.kiora_upsert_research_source/g);
assert.match(sql, /v_knowledge_id uuid; v_existing_id uuid; v_old_id uuid; v_question_id uuid; v_task_id uuid/i);
assert.match(sql, /values\(target_owner,v_knowledge_id,v_source_id,/i);
assert.match(sql, /on conflict\(owner_id,knowledge_id,source_id,relation\) do update/i);

assert.doesNotMatch(sql, /create\s+table|alter\s+table|drop\s+table|delete\s+from/gi);
assert.doesNotMatch(sql, /declare[^\n;]*\b(?:source_id|knowledge_id|question_id|task_id|existing_id|old_id)\s+uuid/gi);

// Repeated processing keeps using the shared idempotent helper and its existing
// run/source conflict target; only the PL/pgSQL local variable name changed.
assert.equal((sql.match(/public\.kiora_upsert_research_source\(target_owner,[^)]+\)/g) || []).length, 2);

console.log("Phase 3 PL/pgSQL ambiguity and repeated-source ON CONFLICT checks passed.");
