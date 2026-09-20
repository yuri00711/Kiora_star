import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { KioraRuntimeError, requireKioraOwner } from "../_shared/kiora-owner.ts";
import { adapterFor } from "./brain-adapters.ts";
import { routeDailyBrain } from "./brain-router.ts";
import { assertChatBudget, budgetSnapshot, calculateCost } from "./budget-manager.ts";
import { sanitizePageContext } from "./context.ts";
import { buildBrainMessages } from "./core.ts";
import type { BrainResult, CostResult, JsonObject, ModelRecord } from "./types.ts";

const ACTIONS = new Set(["status", "bootstrap", "start", "new_conversation", "send_message"]);

function runtimeError(error: unknown): KioraRuntimeError {
  if (error instanceof KioraRuntimeError) return error;
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && typeof (error as JsonObject).message === "string"
    ? String((error as JsonObject).message)
    : "";
  const known = new Set([
    "KIORA_OWNER_REQUIRED", "KIORA_NOT_STARTED", "ACTIVE_CONVERSATION_MISSING",
    "MODEL_NOT_FOUND", "INVALID_MESSAGE", "INVALID_TURN_KEY", "INVALID_CONTEXT",
    "INVALID_ASSISTANT_MESSAGE", "INVALID_USAGE", "MODEL_RUN_NOT_FOUND",
  ]);
  return known.has(message)
    ? new KioraRuntimeError(message, 400)
    : new KioraRuntimeError("RUNTIME_ERROR", 500);
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KioraRuntimeError("INVALID_PAYLOAD", 400);
  return value as JsonObject;
}

function only(source: JsonObject, fields: string[]): void {
  if (Object.keys(source).some((key) => !fields.includes(key))) throw new KioraRuntimeError("INVALID_PAYLOAD", 400);
}

function safeModel(model: ModelRecord | null): JsonObject | null {
  if (!model) return null;
  return {
    id: model.id,
    brain_role: model.brain_role,
    provider: model.provider,
    model_key: model.model_key,
    runtime: model.runtime,
    adapter: model.adapter,
    version: model.version,
    status: model.status,
    is_local: model.is_local,
  };
}

async function loadSettings(db: SupabaseClient, ownerId: string): Promise<JsonObject | null> {
  const { data, error } = await db.from("kiora_settings").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new KioraRuntimeError("SETTINGS_READ_FAILED", 500);
  return data as JsonObject | null;
}

async function loadModel(db: SupabaseClient, ownerId: string, id: unknown): Promise<ModelRecord | null> {
  if (!id) return null;
  const { data, error } = await db.from("kiora_models").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw new KioraRuntimeError("BRAIN_ROUTE_FAILED", 500);
  return data as ModelRecord | null;
}

async function bootstrap(db: SupabaseClient, ownerId: string): Promise<JsonObject> {
  const settings = await loadSettings(db, ownerId);
  if (!settings) return { initialized: false, chat_enabled: false, conversation: null, messages: [], model: null };
  const flags = object(settings.feature_flags || {});
  const activeId = typeof settings.active_conversation_id === "string" ? settings.active_conversation_id : null;
  const model = await loadModel(db, ownerId, settings.daily_brain_model_id);
  let conversation: JsonObject | null = null;
  let messages: JsonObject[] = [];
  if (activeId) {
    const [conversationResult, messageResult] = await Promise.all([
      db.from("kiora_conversations").select("id,title,status,started_at,last_message_at").eq("owner_id", ownerId).eq("id", activeId).maybeSingle(),
      db.from("kiora_messages").select("id,role,content,created_at,reply_to_message_id").eq("owner_id", ownerId).eq("conversation_id", activeId).order("created_at", { ascending: true }).limit(120),
    ]);
    if (conversationResult.error || messageResult.error) throw new KioraRuntimeError("CONVERSATION_READ_FAILED", 500);
    conversation = conversationResult.data as JsonObject | null;
    messages = (messageResult.data || []) as JsonObject[];
  }
  const currency = model ? String(model.cost_config?.currency || "").toUpperCase() || null : null;
  const budget = await budgetSnapshot(db, ownerId, object(settings.budget_config || {}), currency);
  return {
    initialized: true,
    chat_enabled: flags.chat_enabled === true,
    conversation,
    messages,
    model: safeModel(model),
    budget,
    feature_flags: flags,
  };
}

async function coreDefinition(db: SupabaseClient, ownerId: string, coreId: unknown): Promise<JsonObject> {
  if (!coreId) return {};
  const { data, error } = await db.from("kiora_core_versions").select("definition").eq("owner_id", ownerId).eq("id", coreId).maybeSingle();
  if (error) throw new KioraRuntimeError("CORE_READ_FAILED", 500);
  return object(data?.definition || {});
}

async function recentConversation(db: SupabaseClient, ownerId: string, conversationId: string): Promise<Array<{ role: string; content: string }>> {
  const { data, error } = await db.from("kiora_messages")
    .select("role,content,created_at")
    .eq("owner_id", ownerId)
    .eq("conversation_id", conversationId)
    .in("role", ["owner", "kiora"])
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) throw new KioraRuntimeError("CONVERSATION_READ_FAILED", 500);
  return (data || []).reverse() as Array<{ role: string; content: string }>;
}

async function priorTurnResult(db: SupabaseClient, ownerId: string, modelRunId: string): Promise<JsonObject> {
  const { data: run, error } = await db.from("kiora_model_runs")
    .select("status,response_message_id,error_code")
    .eq("owner_id", ownerId).eq("id", modelRunId).single();
  if (error) throw new KioraRuntimeError("MODEL_RUN_READ_FAILED", 500);
  if (run.status === "completed" && run.response_message_id) {
    const { data: message, error: messageError } = await db.from("kiora_messages")
      .select("id,content,created_at")
      .eq("owner_id", ownerId).eq("id", run.response_message_id).single();
    if (messageError) throw new KioraRuntimeError("CONVERSATION_READ_FAILED", 500);
    return { reply: message, duplicate: true };
  }
  if (run.status === "failed") throw new KioraRuntimeError(String(run.error_code || "MODEL_RUN_FAILED"), 409);
  throw new KioraRuntimeError("TURN_IN_PROGRESS", 409);
}

async function failRecordedTurn(
  db: SupabaseClient,
  ownerId: string,
  modelRunId: string,
  error: KioraRuntimeError,
  brainResult: BrainResult | null,
  cost: CostResult | null,
): Promise<void> {
  const args = {
    target_owner: ownerId,
    target_model_run_id: modelRunId,
    failure_code: error.code,
    provider_request: brainResult?.requestId || null,
    used_input_tokens: brainResult?.inputTokens || 0,
    used_output_tokens: brainResult?.outputTokens || 0,
    used_input_cost: cost?.inputCost || 0,
    used_output_cost: cost?.outputCost || 0,
    used_currency: cost?.currency || null,
    used_metadata: brainResult?.usageMetadata || {},
  };
  const { error: failureError } = await db.rpc("kiora_fail_turn", args);
  if (failureError) console.error("KIORA_FAIL_TURN_RECORD_FAILED", failureError.code || "RPC_ERROR");
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const headers = corsHeaders(origin);
  if (!headers) return jsonResponse(origin, { success: false, code: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return jsonResponse(origin, { success: false, code: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const { db, ownerId } = await requireKioraOwner(request);
    const body = object(await request.json());
    const action = String(body.action || "");
    if (!ACTIONS.has(action)) throw new KioraRuntimeError("UNKNOWN_ACTION", 400);

    if (action === "status" || action === "bootstrap") {
      only(body, ["action"]);
      return jsonResponse(origin, { success: true, data: await bootstrap(db, ownerId) });
    }

    if (action === "start") {
      only(body, ["action"]);
      const { error } = await db.rpc("kiora_start_phase1", { target_owner: ownerId });
      if (error) throw error;
      return jsonResponse(origin, { success: true, data: await bootstrap(db, ownerId) });
    }

    if (action === "new_conversation") {
      only(body, ["action", "title"]);
      const title = body.title === undefined ? null : String(body.title).slice(0, 160);
      const { error } = await db.rpc("kiora_create_conversation", { target_owner: ownerId, conversation_title: title });
      if (error) throw error;
      return jsonResponse(origin, { success: true, data: await bootstrap(db, ownerId) });
    }

    only(body, ["action", "content", "client_message_key", "page_context"]);
    const content = String(body.content ?? "").trim();
    const clientKey = String(body.client_message_key ?? "").trim();
    if (!content || content.length > 6000 || clientKey.length < 8 || clientKey.length > 160) {
      throw new KioraRuntimeError("INVALID_MESSAGE", 400);
    }
    const pageContext = sanitizePageContext(body.page_context);
    const settings = await loadSettings(db, ownerId);
    if (!settings || object(settings.feature_flags || {}).chat_enabled !== true) {
      throw new KioraRuntimeError("KIORA_NOT_STARTED", 409);
    }
    const model = await routeDailyBrain(db, ownerId, settings.daily_brain_model_id as string | null);
    const costSnapshot: JsonObject = {
      ...model.cost_config,
      model_id: model.id,
      provider: model.provider,
      model_key: model.model_key,
    };
    const { data: begun, error: beginError } = await db.rpc("kiora_begin_turn", {
      target_owner: ownerId,
      message_content: content,
      message_page_context: pageContext,
      message_client_key: clientKey,
      selected_model_id: model.id,
      model_cost_snapshot: costSnapshot,
    });
    if (beginError) throw beginError;
    const begunTurn = object(begun);
    const modelRunId = String(begunTurn.model_run_id || "");
    if (begunTurn.duplicate === true) {
      return jsonResponse(origin, { success: true, data: await priorTurnResult(db, ownerId, modelRunId) });
    }

    let brainResult: BrainResult | null = null;
    let cost: CostResult | null = null;
    try {
      const currency = String(model.cost_config?.currency || "").toUpperCase() || null;
      const budget = await budgetSnapshot(db, ownerId, object(settings.budget_config || {}), currency);
      if (model.status !== "active") throw new KioraRuntimeError("BRAIN_NOT_CONFIGURED", 503);
      const definition = await coreDefinition(db, ownerId, settings.active_core_version_id);
      const conversationId = String(begunTurn.conversation_id);
      const history = await recentConversation(db, ownerId, conversationId);
      const brainMessages = buildBrainMessages(definition, history, pageContext);
      const estimatedInputTokens = Math.ceil(brainMessages.reduce((sum, message) => sum + message.content.length, 0) / 3);
      const projectedOutputTokens = Math.max(64, Number(model.config?.max_output_tokens) || 800);
      const projectedCost = calculateCost(model, estimatedInputTokens, projectedOutputTokens);
      assertChatBudget(budget, projectedCost.totalCost);
      brainResult = await adapterFor(model.adapter).complete({
        model,
        messages: brainMessages,
      });
      cost = calculateCost(model, brainResult.inputTokens, brainResult.outputTokens);
      const { data: completed, error: completeError } = await db.rpc("kiora_complete_turn", {
        target_owner: ownerId,
        target_model_run_id: modelRunId,
        assistant_content: brainResult.content,
        provider_request: brainResult.requestId,
        used_input_tokens: brainResult.inputTokens,
        used_output_tokens: brainResult.outputTokens,
        used_input_cost: cost.inputCost,
        used_output_cost: cost.outputCost,
        used_currency: cost.currency,
        used_metadata: { ...brainResult.usageMetadata, provider_model: brainResult.providerModel },
      });
      if (completeError) throw completeError;
      return jsonResponse(origin, {
        success: true,
        data: {
          reply: completed,
          conversation_id: conversationId,
          usage: {
            input_tokens: brainResult.inputTokens,
            output_tokens: brainResult.outputTokens,
            amount: cost.totalCost,
            currency: cost.currency,
          },
        },
      });
    } catch (error) {
      const normalized = runtimeError(error);
      await failRecordedTurn(db, ownerId, modelRunId, normalized, brainResult, cost);
      throw normalized;
    }
  } catch (error) {
    const normalized = runtimeError(error);
    if (normalized.status >= 500) console.error("KIORA_RUNTIME_FAILED", normalized.code);
    return jsonResponse(origin, { success: false, code: normalized.code }, normalized.status);
  }
});
