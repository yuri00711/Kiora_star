import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KioraRuntimeError } from "../_shared/kiora-owner.ts";
import { adapterFor } from "./brain-adapters.ts";
import { assertReflectionBudget, budgetSnapshot, calculateCost } from "./budget-manager.ts";
import { explicitFeedback, requestsReflection, type FeedbackSignal } from "./feedback-signals.ts";
import { parseStructuredJson, StructuredOutputError } from "./structured-output.ts";
import type { BrainResult, ChatMessage, CostResult, JsonObject, ModelRecord } from "./types.ts";

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

function reflectionJson(result: BrainResult): JsonObject {
  try {
    return parseStructuredJson(result, "reflection");
  } catch (error) {
    if (error instanceof StructuredOutputError && error.code === "STRUCTURED_OUTPUT_TRUNCATED") {
      throw new KioraRuntimeError("STRUCTURED_OUTPUT_TRUNCATED", 502);
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
  history: JsonObject[],
  currentRelationship: JsonObject,
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
  }).filter((item) => item.content && item.evidence.length > 0) as JsonObject[];

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
  let relationship = object(raw.relationship_update);
  let self = object(raw.self_update);
  if (feedback && !Object.keys(relationship).length) {
    relationship = {
      relationship_definition: text(currentRelationship.relationship_definition || "long-term private AI companion", 2000),
      interaction_patterns: [
        ...array(currentRelationship.interaction_patterns).slice(-15),
        { type: "explicit_feedback", feedback_type: feedback.type, summary: text(feedback.content, 500) },
      ],
      shared_threads: array(currentRelationship.shared_threads).slice(-20),
      important_history: array(currentRelationship.important_history).slice(-20),
      unresolved_threads: array(currentRelationship.unresolved_threads).slice(-20),
    };
  }
  if (feedback && !Object.keys(self).length) {
    self = {
      recent_reflections: [{
        type: "explicit_feedback", feedback_type: feedback.type,
        reflection: "I received explicit feedback and should use the evidenced procedural memory in future similar situations.",
      }],
    };
  }
  const interests = array(raw.interests).slice(0, 6).map((entry) => {
    const item = object(entry);
    const observations = number(item.observations, 0, 0, 100);
    const name = text(item.name, 240);
    const observedInKioraMessages = history.filter((message) => message.role === "kiora"
      && String(message.content || "").toLocaleLowerCase().includes(name.toLocaleLowerCase())).length;
    if (item.kiora_origin !== true || observations < 2 || observedInKioraMessages < 2 || !name) return null;
    return {
      name, kiora_origin: true, observations,
      state: ["emerging", "active", "fading", "inactive"].includes(String(item.state)) ? String(item.state) : "emerging",
      confidence: number(item.confidence, 0.5), origin: text(item.origin || "reflection", 500),
      description: text(item.description, 2000),
    };
  }).filter(Boolean);
  const habits = array(raw.habits).slice(0, 6).map((entry) => {
    const item = object(entry);
    if (!text(item.name, 240)) return null;
    return {
      name: text(item.name, 240), description: text(item.description, 3000), confidence: number(item.confidence, 0.5),
      state: ["emerging", "active", "fading", "inactive"].includes(String(item.state)) ? String(item.state) : "emerging",
    };
  }).filter(Boolean);
  const growth = array(raw.growth_candidates).slice(0, 8).map((entry) => {
    const item = object(entry);
    if (!text(item.statement, 6000)) return null;
    return {
      candidate_type: text(item.candidate_type || "interaction_pattern", 120),
      statement: text(item.statement, 6000), priority: Math.round(number(item.priority, 0, -100, 100)),
    };
  }).filter(Boolean) as JsonObject[];
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
    id: message.id, role: message.role, content: text(message.content, 3000), page_context: object(message.page_context),
  }));
  const schema = {
    memories: [{ memory_type: "episodic|semantic|relational|procedural|self|project|promise", content: "fact", summary: "short", confidence: 0.0, importance: 0.0, context_tags: {}, evidence: [{ message_id: "uuid", evidence_type: "conversation", excerpt: "exact support", weight: 1 }], supersedes_memory_id: "optional existing uuid", links: [{ target_memory_id: "existing uuid", relation: "related_to|supports|contradicts|caused_by|supersedes|part_of", note: "why" }] }],
    confirmed_memory_ids: ["existing uuid"], feedback: null,
    relationship_update: { relationship_definition: "", interaction_patterns: [], shared_threads: [], important_history: [], unresolved_threads: [] },
    self_update: { current_interests: [], open_questions: [], recent_reflections: [], active_relationship_threads: [] },
    interests: [{ name: "Kiora's own sustained interest", kiora_origin: true, observations: 2, state: "emerging", confidence: 0.5, origin: "", description: "" }],
    habits: [{ name: "repeated behavior only", description: "", confidence: 0.5, state: "emerging|active|fading|inactive" }],
    growth_candidates: [{ candidate_type: "interaction_pattern", statement: "", priority: 0 }],
  };
  return [{
    role: "system",
    content: [
      "You are Kiora's private reflection process. Return JSON only, with exactly the documented top-level fields.",
      "Extract only durable, useful information directly supported by supplied message IDs. Every new memory needs evidence.",
      "Do not infer private facts, hidden page content, personality, relationship intimacy, habits, or preferences without evidence.",
      "One occurrence is not a habit. Never convert the OWNER's interest into Kiora's own interest. Kiora interests require at least two observations supplied here.",
      "Return relationship_update only for a meaningful relationship change, preserving shared history; return self_update only for a supported change in Kiora's continuing self-understanding.",
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
  let trigger = input.forceTrigger || (feedback ? "explicit_feedback" : requestsReflection(input.ownerMessage) ? "owner_request" : "");

  const { data: lastRun, error: lastError } = await input.db.from("kiora_model_runs")
    .select("completed_at,request_message_id").eq("owner_id", input.ownerId).eq("conversation_id", input.conversationId)
    .eq("run_kind", "reflection").eq("status", "completed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (lastError) throw new KioraRuntimeError("REFLECTION_STATE_READ_FAILED", 500);
  if (input.forceTrigger === "conversation_switch" && lastRun?.request_message_id === input.sourceMessageId) {
    return { status: "already_reflected" };
  }
  if (!trigger) {
    let countQuery = input.db.from("kiora_messages").select("id", { count: "exact", head: true })
      .eq("owner_id", input.ownerId).eq("conversation_id", input.conversationId).in("role", ["owner", "kiora"]);
    if (lastRun?.completed_at) countQuery = countQuery.gt("created_at", lastRun.completed_at);
    const { count, error } = await countQuery;
    if (error) throw new KioraRuntimeError("REFLECTION_STATE_READ_FAILED", 500);
    if ((count || 0) < threshold) return { status: "not_due" };
    trigger = "message_threshold";
  }

  const [historyResult, memoryResult, relationshipResult] = await Promise.all([
    input.db.from("kiora_messages").select("id,role,content,page_context,created_at")
      .eq("owner_id", input.ownerId).eq("conversation_id", input.conversationId)
      .in("role", ["owner", "kiora"]).order("created_at", { ascending: false }).limit(20),
    input.db.from("kiora_memories").select("id,memory_type,summary,content,confidence,status,context_tags")
      .eq("owner_id", input.ownerId).in("status", ["active", "uncertain"]).order("importance", { ascending: false }).limit(30),
    input.db.from("kiora_relationship_snapshots").select("*").eq("owner_id", input.ownerId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (historyResult.error || memoryResult.error || relationshipResult.error) throw new KioraRuntimeError("REFLECTION_CONTEXT_READ_FAILED", 500);
  const history = (historyResult.data || []).reverse() as JsonObject[];
  const existingMemories = ((memoryResult.data || []) as JsonObject[]).map((memory) => ({
    id: memory.id,
    memory_type: memory.memory_type,
    summary: text(memory.summary || memory.content, 800),
    confidence: memory.confidence,
    status: memory.status,
    context_tags: object(memory.context_tags),
  }));
  const currentRelationship = object(relationshipResult.data);
  const allowedMessageIds = new Set(history.map((item) => String(item.id)));
  const allowedMemoryIds = new Set(existingMemories.map((item) => String(item.id)));
  const brainMessages = reflectionPrompt(input, history, existingMemories, feedback);
  const estimatedInputTokens = Math.ceil(brainMessages.reduce((sum, message) => sum + message.content.length, 0) / 3);
  const reflectionOutputTokens = Math.min(3000, Math.max(400, Number(config.max_output_tokens) || 1400));
  const reflectionModel: ModelRecord = {
    ...input.model,
    config: { ...input.model.config, max_output_tokens: reflectionOutputTokens },
  };
  const projected = calculateCost(reflectionModel, estimatedInputTokens, reflectionOutputTokens);
  const currency = String(input.model.cost_config?.currency || "").toUpperCase() || null;
  const budget = await budgetSnapshot(input.db, input.ownerId, object(input.settings.budget_config), currency);
  let deterministicOnlyReason = "";
  try {
    assertReflectionBudget(budget, projected.totalCost);
  } catch (error) {
    if (error instanceof KioraRuntimeError && error.code === "REFLECTION_BUDGET_DEFERRED") {
      if (feedback) {
        deterministicOnlyReason = error.code;
      } else {
      await deferReflection(input, trigger, error.code);
      return { status: "deferred" };
      }
    }
    if (!deterministicOnlyReason) throw error;
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
  let result: BrainResult | null = null;
  let cost: CostResult | null = null;
  try {
    if (deterministicOnlyReason) {
      const payload = validatedPayload({}, trigger, input, feedback, allowedMessageIds, allowedMemoryIds, history, currentRelationship);
      const { data, error } = await input.db.rpc("kiora_complete_reflection", {
        target_owner: input.ownerId, target_model_run_id: modelRunId, reflection_payload: payload,
        provider_request: null, used_input_tokens: 0, used_output_tokens: 0,
        used_input_cost: 0, used_output_cost: 0, used_currency: currency,
        used_metadata: { trigger, deterministic_feedback_fallback: true, reason: deterministicOnlyReason },
      });
      if (error) throw error;
      return { status: "completed", mode: "deterministic_feedback_fallback", result: data };
    }
    result = await adapterFor(reflectionModel.adapter).complete({
      model: reflectionModel,
      messages: brainMessages,
      outputFormat: "json_object",
    });
    cost = calculateCost(reflectionModel, result.inputTokens, result.outputTokens);
    const payload = validatedPayload(reflectionJson(result), trigger, input, feedback, allowedMessageIds, allowedMemoryIds, history, currentRelationship);
    const { data, error } = await input.db.rpc("kiora_complete_reflection", {
      target_owner: input.ownerId, target_model_run_id: modelRunId, reflection_payload: payload,
      provider_request: result.requestId, used_input_tokens: result.inputTokens, used_output_tokens: result.outputTokens,
      used_input_cost: cost.inputCost, used_output_cost: cost.outputCost, used_currency: cost.currency,
      used_metadata: {
        ...result.usageMetadata,
        provider_model: result.providerModel,
        finish_reason: result.finishReason,
        trigger,
      },
    });
    if (error) throw error;
    return { status: "completed", result: data };
  } catch (error) {
    const code = error instanceof KioraRuntimeError ? error.code : "REFLECTION_FAILED";
    if (feedback && (result === null || ["REFLECTION_RESPONSE_INVALID", "STRUCTURED_OUTPUT_TRUNCATED"].includes(code))) {
      const payload = validatedPayload({}, trigger, input, feedback, allowedMessageIds, allowedMemoryIds, history, currentRelationship);
      const { data, error: fallbackError } = await input.db.rpc("kiora_complete_reflection", {
        target_owner: input.ownerId, target_model_run_id: modelRunId, reflection_payload: payload,
        provider_request: result?.requestId || null,
        used_input_tokens: result?.inputTokens || 0, used_output_tokens: result?.outputTokens || 0,
        used_input_cost: cost?.inputCost || 0, used_output_cost: cost?.outputCost || 0,
        used_currency: cost?.currency || currency,
        used_metadata: {
          ...(result?.usageMetadata || {}), provider_model: result?.providerModel || null,
          finish_reason: result?.finishReason || null,
          trigger, deterministic_feedback_fallback: true, reason: code,
        },
      });
      if (!fallbackError) return { status: "completed", mode: "deterministic_feedback_fallback", result: data };
      console.error("KIORA_FEEDBACK_FALLBACK_FAILED", fallbackError.code || "RPC_ERROR");
    }
    const { error: failError } = await input.db.rpc("kiora_fail_reflection", {
      target_owner: input.ownerId, target_model_run_id: modelRunId, failure_code: code,
      provider_request: result?.requestId || null,
      used_input_tokens: result?.inputTokens || 0,
      used_output_tokens: result?.outputTokens || 0,
      used_input_cost: cost?.inputCost || 0,
      used_output_cost: cost?.outputCost || 0,
      used_currency: cost?.currency || null,
      used_metadata: result
        ? {
          ...result.usageMetadata,
          provider_model: result.providerModel,
          finish_reason: result.finishReason,
          trigger,
        }
        : { trigger },
    });
    if (failError) console.error("KIORA_FAIL_REFLECTION_RECORD_FAILED", failError.code || "RPC_ERROR");
    throw error;
  }
}
