import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KioraRuntimeError } from "../_shared/kiora-owner.ts";
import type { ModelRecord } from "./types.ts";

export async function routeDailyBrain(
  db: SupabaseClient,
  ownerId: string,
  dailyModelId: string | null,
): Promise<ModelRecord> {
  let query = db.from("kiora_models").select("*").eq("owner_id", ownerId);
  query = dailyModelId
    ? query.eq("id", dailyModelId)
    : query.eq("brain_role", "daily").order("created_at", { ascending: true }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("KIORA_BRAIN_ROUTE_FAILED", error.code || "QUERY_ERROR");
    throw new KioraRuntimeError("BRAIN_ROUTE_FAILED", 500);
  }
  if (!data) throw new KioraRuntimeError("BRAIN_NOT_CONFIGURED", 503);
  return data as ModelRecord;
}
