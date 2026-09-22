import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const pagination = await import(new URL("supabase/functions/kiora-runtime/message-pagination.ts", root).href);
const reflection = await readFile(new URL("supabase/functions/kiora-runtime/reflection.ts", root), "utf8");
const runtime = await readFile(new URL("supabase/functions/kiora-runtime/index.ts", root), "utf8");
const dock = await readFile(new URL("kiora/kiora-dock.js", root), "utf8");

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function rows(count, sameTimestamp = false) {
  return Array.from({ length: count }, (_, offset) => ({
    id: uuid(offset + 1),
    role: offset % 2 ? "kiora" : "owner",
    content: `message-${offset + 1}`,
    created_at: sameTimestamp
      ? "2026-09-22T00:00:00.000Z"
      : new Date(Date.UTC(2026, 0, 1, 0, 0, offset + 1)).toISOString(),
  }));
}

function descending(source) {
  return [...source].sort((left, right) => {
    const time = String(right.created_at).localeCompare(String(left.created_at));
    return time || String(right.id).localeCompare(String(left.id));
  });
}

function before(source, cursor) {
  return source.filter((message) => message.created_at < cursor.created_at
    || (message.created_at === cursor.created_at && message.id < cursor.id));
}

for (const count of [20, 120, 121, 300]) {
  const source = rows(count);
  const page = pagination.newestMessagePage(descending(source).slice(0, 41), 40);
  assert.equal(page.messages.length, Math.min(count, 40));
  assert.equal(page.messages.at(-1).content, `message-${count}`, `${count} messages must include the latest message`);
  assert.deepEqual(page.messages.map((message) => message.content),
    source.slice(Math.max(0, count - 40)).map((message) => message.content));
}

const oneTwenty = rows(120);
const newest = pagination.newestMessagePage(descending(oneTwenty).slice(0, 41), 40);
assert.equal(newest.messages[0].content, "message-81");
assert.equal(newest.messages.at(-1).content, "message-120");
const olderRows = descending(before(oneTwenty, newest.oldest_message_cursor)).slice(0, 41);
const older = pagination.olderMessagePage(olderRows, 40);
assert.equal(older.messages[0].content, "message-41");
assert.equal(older.messages.at(-1).content, "message-80");
assert.equal(new Set([...older.messages, ...newest.messages].map((message) => message.id)).size, 80);

const tied = rows(75, true);
const tiedNewest = pagination.newestMessagePage(descending(tied).slice(0, 41), 40);
const tiedOlderRows = descending(before(tied, tiedNewest.oldest_message_cursor)).slice(0, 41);
const tiedOlder = pagination.olderMessagePage(tiedOlderRows, 40);
assert.equal(tiedNewest.messages.length, 40);
assert.equal(tiedOlder.messages.length, 35);
assert.equal(new Set([...tiedOlder.messages, ...tiedNewest.messages].map((message) => message.id)).size, 75,
  "created_at ties must use id without gaps or duplicates");
assert.match(pagination.olderMessagesFilter(tiedNewest.oldest_message_cursor), /created_at\.eq\..*id\.lt\./);
assert.match(pagination.newerMessagesFilter(tiedNewest.latest_message_cursor), /created_at\.eq\..*id\.gt\./);
assert.equal(pagination.messagePageLimit(undefined), 40);
assert.equal(pagination.messagePageLimit(999), 60);

assert.match(reflection, /compactReflectionPrompt/);
assert.match(reflection, /reflectionRetryAttempted = true/);
assert.match(reflection, /assertReflectionBudget\(budget, usage\.totalCost \+ retryProjected\.totalCost\)/);
assert.match(reflection, /structured_attempt_count: usage\.attempts\.length/);
assert.match(reflection, /KIORA_REFLECTION_DEFERRED_AFTER_TRUNCATION/);
assert.match(reflection, /deterministic_feedback_fallback/);
assert.match(reflection, /slice\(0, 2\)/, "compact retry output must hard-limit durable arrays");

assert.match(runtime, /"load_older_messages", "load_messages_after"/);
assert.match(runtime, /order\("created_at", \{ ascending: false \}\)\.order\("id", \{ ascending: false \}\)/);
assert.match(runtime, /\.limit\(INITIAL_MESSAGE_LIMIT\)/);
assert.match(runtime, /\.or\(olderMessagesFilter\(oldest\)\)\.limit\(1\)/,
  "bootstrap must check for an older row without returning more than 40 messages");
assert.doesNotMatch(runtime, /\.limit\(120\)/);
assert.match(runtime, /owner_message: ownerMessage/);

assert.match(dock, /LOAD EARLIER MESSAGES/);
assert.match(dock, /state\.messages = mergeMessages\(result\.messages \|\| \[\], state\.messages \|\| \[\]\)/);
assert.match(dock, /messages\.scrollHeight - previousScrollHeight \+ previousScrollTop/);
assert.match(dock, /state\.messages = mergeMessages\(state\.messages, persisted\)/,
  "send success must append returned persisted messages to state");
assert.match(dock, /if \(state && Array\.isArray\(state\.messages\)\)[\s\S]*?render\(\{ scroll: "preserve"/,
  "reopen must render in-memory state");
assert.match(dock, /loadedOwnerIdentity !== ownerIdentity \|\| !state/,
  "bootstrap must be tied to owner identity changes");

console.log("Phase 3 reflection retry and cursor-based chat pagination checks passed.");
