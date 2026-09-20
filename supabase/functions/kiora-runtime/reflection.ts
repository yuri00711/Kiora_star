import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KioraRuntimeError } from "../_shared/kiora-owner.ts";
import { adapterFor } from "./brain-adapters.ts";
import { assertReflectionBudget, budgetSnapshot, calculateCost } from "./budget-manager.ts";
import type { ChatMessage, JsonObject, ModelRecord } from "./types.ts";

type FeedbackSignal = { type: "correction" | "rejected" | "accepted" | "preference"; content: string } | null;
type ReflectionInput = {
  db: SupabaseClient;
  ownerId: string;
  conversationId: string;
  sourceMessageId: string;
  ownerMessage: string;
  assistantMessageId?: string | null;
  assistantMessage?: string;
  pageContext: JsonObject;
  settings: JsonObject;
  model: ModelRecord;
  forceTrigger?: "manual" | "conversation_switch";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function number(value: unknown, fallback: number, min = 0, max = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function explicitFeedback(textValue: string): FeedbackSignal {
  const content = textValue.trim();
  if (content.length < 4) return null;
  if (/(你记错了|你搞错了|这不对|不是这样|不是.+而是|不是.+是|我说的是|纠正一下|请更正|覚え違い|違います|not what i said|that's wrong|you got .* wrong)/i.test(content)) {
    return { type: "correction", content };
  }
  if (/(我不喜欢这种回答|不要这样回答|别再这样|这个回答不行|この答え方は嫌|don't answer like that)/i.test(content)) {
    return { type: "rejected", content };
  }
  if (/(请记住|以后请|我希望你以后|回答时请|これからは|please remember|from now on)/i.test(content)) {
    return { type: "preference", content };
  }
  if (/(对，就是这样|这个回答很好|这样回答就好|正是我想要的|この感じでいい|exactly what i meant)/i.test(content)) {
    return { type: "accepted", content };
  }
  return null;
}

function jsonFromModel(content: string): JsonObject {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(stripped);
    return object(parsed);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return object(JSON.parse(stripped.slice(start, end + 1))); } catch { /* handled below */ }
    }
    throw new KioraRuntimeError("REFLECTION_RESPONSE_INVALID", 502);
  }
}

function validUuid(value: unknown, allowed?: Set<string>): string | null {
  const candidate = String(value ?? "");
  return UUID.test(candidate) && (!allowed || allowed.has(candidate)) ? candidate : null;
}

function validatedPayload(
  raw: JsonObject,
  trigger: string,
  input: ReflectionInput,
  feedback: FeedbackSignal,
  allowedMessageIds: Set<string>,
  allowedMemoryIds: Set<string>,
): JsonObject {
  const maxMemories = Math.min(8, Math.max(1, Number(object(input.settings.reflection_config).max_memories_per_reflection) || 4));
  const memories = array(raw.memories).slice(0, maxMemories).map((value) => {
    const item = object(value);
    const memoryType = ["episodic", "semantic", "relational", "procedural", "self", "project", "promise"].includes(String(item.memory_type))
      ? String(item.memory_type) : "episodic";
    const evidence = array(item.evidence).slice(0, 5).map((entry) => {
      const source = object(entry);
      const messageId = validUuid(source.message_id, allowedMessageIds);
      return messageId ? {
        message_id: messageId,
        evidence_type: text(source.evidence_type || "conversation", 80),
        excerpt: text(source.excerpt, 1000),
        weight: number(source.weight, 1),
      } : null;
    }).filter(Boolean);
    const links = array(item.links).slice(0, 6).map((entry) => {
      const source = object(entry);
      const targetMemoryId = validUuid(source.target_memory_id, allowedMemoryIds);
      const relation = ["related_to", "supports", "contradicts", "caused_by", "supersedes", "part_of"].includes(String(source.relation))
        ? String(source.relation) : null;
      return targetMemoryId && relation ? { target_memory_id: targetMemoryId, relation, note: text(source.note, 500) } : null;
    }).filter(Boolean);
    const supersedes = validUuid(item.supersedes_memory_id, allowedMemoryIds);
    return {
      memory_type: memoryType,
      content: text(item.content, 12000),
      summary: text(item.summary, 1000),
      confidence: number(item.confidence, 0.55),
      importance: number(item.importance, 0.5),
      context_tags: object(item.context_tags), evidence, links,
      ...(supersedes ? { supersedes_memory_id: supersedes } : {}),
    };
  }).filter((item) => item.content && item.evidence.length > 0);

  if (feedback && ["correction", "preference", "rejected"].includes(feedback.type)) {
    const evidence = [{ message_id: input.sourceMessageId, evidence_type: "explicit_owner_feedback", excerpt: feedback.content, weight: 1 }];
    if (!memories.some((item) => item.memory_type === "procedural")) memories.push({
      memory_type: "procedural", content: `OWNER explicitly stated this response preference/correction: ${feedback.content}`,
      summary: "Explicit OWNER correction or response preference", confidence: 0.96, importance: 0.86,
      context_tags: { page: input.pageContext.page, explicit_feedback: true }, evidence, links: [],
    });
    if (!memories.some((item) => item.memory_type === "self")) memories.push({
      memory_type: "self", content: "Kiora received an explicit correction and should verify this point instead of repeating the prior assumption.",
      summary: "I was explicitly corrected on this point", confidence: 0.92, importance: 0.8,
      context_tags: { page: input.pageContext.page, source: "owner_correction" }, evidence, links: [],
    });
  }

  const feedbackPayload = feedback ? {
    type: feedback.type,
    content: feedback.content,
    source_message_id: input.sourceMessageId,
    assistant_message_id: input.assistantMessageId || null,
    explicit: true,
  } : null;
  const confirmed = array(raw.confirmed_memory_ids).map((id) => validUuid(id, allowedMemoryIds)).filter(Boolean).slice(0, 12);
  const relationship = object(raw.relationship_update);
  const self = object(raw.self_update);
  const interests = array(raw.interests).slice(0, 6).map((entry) => object(entry)).filter((item) =>
    item.kiora_origin === true && number(item.observations, 0, 0, 100) >= 2 && text(item.name, 240));
  const habits = array(raw.habits).slice(0, 6).map((entry) => object(entry)).filter((item) => text(item.name, 240));
  const growth = array(raw.growth_candidates).slice(0, 8).map((entry) => object(entry)).filter((item) => text(item.statement, 6000));
  if (feedback && !growth.some((item) => item.candidate_type === "explicit_feedback")) growth.push({
    candidate_type: "explicit_feedback", statement: feedback.content, priority: feedback.type === "correction" ? 8 : 5,
  });
  return {
    trigger,
    feedback: feedbackPayload,
    confirmed_memory_ids: confirmed,
    memories: memories.slice(0, maxMemories + (feedback ? 2 : 0)),
    relationship_update: Object.keys(relationship).length ? relationship : null,
    self_update: Object.keys(self).length ? self : null,
    interests,
    habits,
    growth_candidates: growth,
  };
}

function reflectionPrompt(input: ReflectionInput, history: JsonObject[], existingMemories: JsonObject[], feedback: FeedbackSignal): ChatMessage[] {
  const transcript = history.map((message) => ({
    id: message.id, role: message.role, content: text(message.content, 8000), page_context: object(message.page_context),
  }));
  const schema = {
    memories: [{ memory_type: "episodic|semantic|relational|procedural|self|project|promise", content: "fact", summary: "short", confidence: 0.0, importance: 0.0, context_tags: {}, evidence: [{ message_id: "uuid", evidence_type: "conversation", excerpt: "exact support", weight: 1 }], supersedes_memory_id: "optional existing uuid", links: [{ target_memory_id: "existing uuid", relation: "related_to|supports|contradicts|caused_by|supersedes|part_of", note: "why" }] }],
    confirmed_memory_ids: ["existing uuid"], feedback: null,
    relationship_update: { relationship_definition: "", interaction_patterns: [], shared_threads: [], important_history: [], unresolved_threads: [] },
    self_update: { current_interests: [], open_questions: [], recent_reflections: [], active_relationship_threads: [] },
    interests: [{ name: "Kiora's own sustained interest", kiora_origin: true, observations: 2, state: "emerging", confidence: 0.5, origin: "", description: "" }],
    habits: [{ name: "repeated behavior only", description: "", confidence: 0.5 }],
    growth_candidates: [{ candidate_type: "interaction_pattern", statement: "", priority: 0 }],
  };
  return [{
    role: "system",
    content: [
      "You are Kiora's private reflection process. Return JSON only, with exactly the documented top-level fields.",
      "Extract only durable, useful information directly supported by supplied message IDs. Every new memory needs evidence.",
      "Do not infer private facts, hidden page content, personality, relationship intimacy, habits, or preferences without evidence.",
      "One occurrence is not a habit. Never convert the OWNER's interest into Kiora's own interest. Kiora interests require at least two observations supplied here.",
      "Contradictions should create a new supported memory that supersedes the old one; do not silently rewrite history.",
      "Uncertain claims must have confidence below 0.72. Do not request deletion or forgetting.",
      `Required JSON shape: ${JSON.stringify(schema)}`,
    ].join("\n"),
  }, {
    role: "user",
    content: JSON.stringify({ trigger: input.forceTrigger || (feedback ? "explicit_feedback" : "message_threshold"), feedback, page_context: input.pageContext, existing_memories: existingMemories, transcript }),
  }];
}

async function deferReflection(input: ReflectionInput, trigger: string, reason: string): Promise<void> {
  const { error } = await input.db.rpc("kiora_defer_reflection", {
    target_owner: input.ownerId, target_conversation_id: input.conversationId,
    source_message_id: input.sourceMessageId, reflection_trigger: trigger, defer_reason: reason,
  });
  if (error) console.error("KIORA_REFLECTION_DEFER_RECORD_FAILED", error.code || "RPC_ERROR");
}

export async function maybeReflect(input: ReflectionInput): Promise<JsonObject> {
  const flags = object(input.settings.feature_flags);
  if (flags.memory_enabled !== true) return { status: "disabled" };
  const feedback = explicitFeedback(input.ownerMessage);
  const config = object(input.settings.reflection_config);
  const threshold = Math.min(60, Math.max(4, Number(config.message_threshold) || 12));
  let trigger = input.forceTrigger || (feedback ? "explicit_feedback" : "");

  const { data: lastRun, error: lastError } = await input.db.from("kiora_model_runs")
    .select("completed_at").eq("owner_id", input.ownerId).eq("conversation_id", input.conversationId)
    .eq("run_kind", "reflection").eq("status", "completed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (lastError) throw new KioraRuntimeError("REFLECTION_STATE_READ_FAILED", 500);
  if (!trigger) {
    let countQuery = input.db.from("kiora_messages").select("id", { count: "exact", head: true })
      .eq("owner_id", input.ownerId).eq("conversation_id", input.conversationId).in("role", ["owner", "kiora"]);
    if (lastRun?.completed_at) countQuery = countQuery.gt("created_at", lastRun.completed_at);
    const { count, error } = await countQuery;
    if (error) throw new KioraRuntimeError("REFLECTION_STATE_READ_FAILED", 500);
    if ((count || 0) < threshold) return { status: "not_due" };
    trigger = "message_threshold";
  }

  const [historyResult, memoryResult] = await Promise.all([
    input.db.from("kiora_messages").select("id,role,content,page_context,created_at")
      .eq("owner_id", input.ownerId).eq("conversation_id", input.conversationId)
      .in("role", ["owner", "kiora"]).order("created_at", { ascending: false }).limit(32),
    input.db.from("kiora_memories").select("id,memory_type,summary,content,confidence,status,context_tags")
      .eq("owner_id", input.ownerId).in("status", ["active", "uncertain"]).order("importance", { ascending: false }).limit(80),
  ]);
  if (historyResult.error || memoryResult.error) throw new KioraRuntimeError("REFLECTION_CONTEXT_READ_FAILED", 500);
  const history = (historyResult.data || []).reverse() as JsonObject[];
  const existingMemories = (memoryResult.data || []) as JsonObject[];
  const allowedMessageIds = new Set(history.map((item) => String(item.id)));
  const allowedMemoryIds = new Set(existingMemories.map((item) => String(item.id)));
  const brainMessages = reflectionPrompt(input, history, existingMemories, feedback);
  const estimatedInputTokens = Math.ceil(brainMessages.reduce((sum, message) => sum + message.content.length, 0) / 3);
  const estimatedOutputTokens = Math.max(128, Number(input.model.config?.max_output_tokens) || 800);
  const projected = calculateCost(input.model, estimatedInputTokens, estimatedOutputTokens);
  const currency = String(input.model.cost_config?.currency || "").toUpperCase() || null;
  const budget = await budgetSnapshot(input.db, input.ownerId, object(input.settings.budget_config), currency);
  try {
    assertReflectionBudget(budget, projected.totalCost);
  } catch (error) {
    if (error instanceof KioraRuntimeError && error.code === "REFLECTION_BUDGET_DEFERRED") {
      await deferReflection(input, trigger, error.code);
      return { status: "deferred" };
    }
    throw error;
  }

  const reflectionKey = `reflection:${input.conversationId}:${input.sourceMessageId}:${trigger}`;
  const { data: begun, error: beginError } = await input.db.rpc("kiora_begin_reflection", {
    target_owner: input.ownerId, target_conversation_id: input.conversationId,
    selected_model_id: input.model.id, source_message_id: input.sourceMessageId,
    reflection_key: reflectionKey, reflection_trigger: trigger,
    model_cost_snapshot: { ...input.model.cost_config, model_id: input.model.id, provider: input.model.provider, model_key: input.model.model_key },
  });
  if (beginError) throw beginError;
  const begunRun = object(begun);
  if (begunRun.duplicate === true) return { status: String(begunRun.status || "duplicate") };
  const modelRunId = String(begunRun.model_run_id);
  try {
    const result = await adapterFor(input.model.adapter).complete({ model: input.model, messages: brainMessages });
    const cost = calculateCost(input.model, result.inputTokens, result.outputTokens);
    const payload = validatedPayload(jsonFromModel(result.content), trigger, input, feedback, allowedMessageIds, allowedMemoryIds);
    const { data, error } = await input.db.rpc("kiora_complete_reflection", {
      target_owner: input.ownerId, target_model_run_id: modelRunId, reflection_payload: payload,
      provider_request: result.requestId, used_input_tokens: result.inputTokens, used_output_tokens: result.outputTokens,
      used_input_cost: cost.inputCost, used_output_cost: cost.outputCost, used_currency: cost.currency,
      used_metadata: { ...result.usageMetadata, provider_model: result.providerModel, trigger },
    });
    if (error) throw error;
    return { status: "completed", result: data };
  } catch (error) {
    const code = error instanceof KioraRuntimeError ? error.code : "REFLECTION_FAILED";
    const { error: failError } = await input.db.rpc("kiora_fail_reflection", {
      target_owner: input.ownerId, target_model_run_id: modelRunId, failure_code: code,
    });
    if (failError) console.error("KIORA_FAIL_REFLECTION_RECORD_FAILED", failError.code || "RPC_ERROR");
    throw error;
  }
}
