import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KioraRuntimeError } from "../_shared/kiora-owner.ts";
import type { CostResult, JsonObject, ModelRecord } from "./types.ts";

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function billingUnit(value: unknown): number | null {
  const numeric = finite(value);
  if (numeric && numeric > 0) return numeric;
  const normalized = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["pertoken", "token", "1token"].includes(normalized)) return 1;
  if (["per1ktokens", "1ktokens", "1000tokens"].includes(normalized)) return 1_000;
  if (["per1mtokens", "1mtokens", "1000000tokens"].includes(normalized)) return 1_000_000;
  return null;
}

export function calculateCost(model: ModelRecord, inputTokens: number, outputTokens: number): CostResult {
  const config = model.cost_config || {};
  const inputRate = finite(config.input_cost);
  const outputRate = finite(config.output_cost);
  const unit = billingUnit(config.billing_unit);
  const currency = String(config.currency ?? "").trim().toUpperCase();
  if (inputRate === null || outputRate === null || unit === null || !currency) {
    throw new KioraRuntimeError("BRAIN_COST_CONFIG_INVALID", 503);
  }
  const inputCost = (Math.max(0, inputTokens) / unit) * inputRate;
  const outputCost = (Math.max(0, outputTokens) / unit) * outputRate;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency,
    snapshot: { ...config, model_id: model.id, provider: model.provider, model_key: model.model_key },
  };
}

export async function budgetSnapshot(
  db: SupabaseClient,
  ownerId: string,
  budgetConfig: JsonObject,
  currency: string | null,
): Promise<JsonObject> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  let query = db.from("kiora_usage_ledger")
    .select("amount,currency,category")
    .eq("owner_id", ownerId)
    .gte("occurred_at", start.toISOString());
  if (currency) query = query.eq("currency", currency);
  const { data, error } = await query;
  if (error) throw new KioraRuntimeError("BUDGET_READ_FAILED", 500);
  const rows = data || [];
  const spent = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const chatSpent = rows.filter((row) => row.category === "chat").reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const reflectionSpent = rows.filter((row) => row.category === "reflection").reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return {
    currency: currency || budgetConfig.currency || null,
    spent,
    chat_spent: chatSpent,
    reflection_spent: reflectionSpent,
    monthly_budget: finite(budgetConfig.monthly_budget),
    soft_limit: finite(budgetConfig.soft_limit),
    hard_limit: finite(budgetConfig.hard_limit),
    chat_budget: finite(budgetConfig.chat_budget),
    background_budget: finite(budgetConfig.background_budget),
  };
}

export function assertReflectionBudget(snapshot: JsonObject, projectedCost = 0): void {
  const spent = Number(snapshot.spent) || 0;
  const reflectionSpent = Number(snapshot.reflection_spent) || 0;
  const projected = Math.max(0, projectedCost);
  const hard = finite(snapshot.hard_limit) ?? finite(snapshot.monthly_budget);
  const background = finite(snapshot.background_budget);
  if (hard !== null && spent + projected > hard) throw new KioraRuntimeError("REFLECTION_BUDGET_DEFERRED", 402);
  if (background !== null && reflectionSpent + projected > background) {
    throw new KioraRuntimeError("REFLECTION_BUDGET_DEFERRED", 402);
  }
}

export function assertChatBudget(snapshot: JsonObject, projectedCost = 0): void {
  const spent = Number(snapshot.spent) || 0;
  const chatSpent = Number(snapshot.chat_spent) || 0;
  const hard = finite(snapshot.hard_limit) ?? finite(snapshot.monthly_budget);
  const chat = finite(snapshot.chat_budget);
  if (hard !== null && spent + Math.max(0, projectedCost) > hard) throw new KioraRuntimeError("BUDGET_HARD_LIMIT", 402);
  if (chat !== null && chatSpent + Math.max(0, projectedCost) > chat) throw new KioraRuntimeError("CHAT_BUDGET_LIMIT", 402);
}
