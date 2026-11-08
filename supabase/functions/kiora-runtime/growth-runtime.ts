import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KioraRuntimeError } from "../_shared/kiora-owner.ts";
import type { JsonObject } from "./types.ts";
import { selectGrowthRules, type GrowthRuntimeSelection } from "./growth-retrieval.ts";
import { temporaryOverlayFromMessage } from "./growth-overlay.ts";

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

export async function createImmediateCorrectionOverlay(input: {
  db: SupabaseClient;
  ownerId: string;
  messageId: string;
  content: string;
  settings: JsonObject;
}): Promise<JsonObject | null> {
  const flags = object(input.settings.feature_flags);
  if (flags.temporary_growth_overlays_enabled !== true) return null;
  const draft = temporaryOverlayFromMessage(input.content);
  if (!draft) return null;
  const expiresAt = new Date(Date.now() + draft.ttlDays * 86_400_000).toISOString();
  const { data, error } = await input.db.rpc("kiora_create_temporary_growth_overlay", {
    target_owner: input.ownerId,
    target_scope: draft.scope,
    target_instruction: draft.instruction,
    target_source_kind: draft.sourceKind,
    target_source_message_id: input.messageId,
    target_expires_at: expiresAt,
  });
  if (error) throw new KioraRuntimeError(error.message || "GROWTH_OVERLAY_CREATE_FAILED", 500);
  return object(data);
}

export async function loadGrowthRuntime(input: {
  db: SupabaseClient;
  ownerId: string;
  settings: JsonObject;
  currentMessage: string;
  pageContext: JsonObject;
  conversationState?: JsonObject;
  relationshipState?: JsonObject | null;
}): Promise<GrowthRuntimeSelection> {
  const flags = object(input.settings.feature_flags);
  const disabled = () => selectGrowthRules({
    activeGrowthVersion: null, snapshotId: null, rules: [], overlays: [],
    currentMessage: input.currentMessage, pageContext: input.pageContext,
  });
  if (flags.growth_runtime_enabled !== true) return disabled();
  if (flags.temporary_growth_overlays_enabled === true) {
    const { error } = await input.db.rpc("kiora_expire_growth_overlays", { target_owner: input.ownerId });
    if (error) throw new KioraRuntimeError("GROWTH_OVERLAY_EXPIRY_FAILED", 500);
  }
  const activeId = String(input.settings.active_growth_version_id || "");
  let activeGrowthVersion: JsonObject | null = null;
  let snapshot: JsonObject | null = null;
  let rules: JsonObject[] = [];
  if (activeId) {
    const { data: version, error: versionError } = await input.db.from("kiora_growth_versions")
      .select("id,version,status,activated_at").eq("owner_id", input.ownerId).eq("id", activeId).eq("status", "active").maybeSingle();
    if (versionError) throw new KioraRuntimeError("GROWTH_CONTEXT_READ_FAILED", 500);
    activeGrowthVersion = version as JsonObject | null;
    if (activeGrowthVersion) {
      const { data: snapshotData, error: snapshotError } = await input.db.from("kiora_compiled_growth_snapshots")
        .select("id,growth_version_id,status,compiler_version,checksum,conflict_count,compiled_at")
        .eq("owner_id", input.ownerId).eq("growth_version_id", activeId).eq("status", "valid").maybeSingle();
      if (snapshotError) throw new KioraRuntimeError("GROWTH_CONTEXT_READ_FAILED", 500);
      snapshot = snapshotData as JsonObject | null;
      if (snapshot) {
        const { data: ruleData, error: ruleError } = await input.db.from("kiora_growth_rules")
          .select("id,scope,instruction,priority,evidence_strength,rule_key,relevance_terms,supersedes_rule_id,enabled,created_at")
          .eq("owner_id", input.ownerId).eq("snapshot_id", snapshot.id).eq("enabled", true)
          .order("priority", { ascending: false }).limit(60);
        if (ruleError) throw new KioraRuntimeError("GROWTH_CONTEXT_READ_FAILED", 500);
        rules = (ruleData || []) as JsonObject[];
      }
    }
  }
  let overlays: JsonObject[] = [];
  if (flags.temporary_growth_overlays_enabled === true) {
    const { data, error } = await input.db.from("kiora_temporary_growth_overlays")
      .select("id,scope,instruction,source_kind,source_message_id,created_at,expires_at,status")
      .eq("owner_id", input.ownerId).eq("status", "active").gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(12);
    if (error) throw new KioraRuntimeError("GROWTH_CONTEXT_READ_FAILED", 500);
    overlays = (data || []) as JsonObject[];
  }
  return selectGrowthRules({
    activeGrowthVersion,
    snapshotId: snapshot ? String(snapshot.id) : null,
    rules,
    overlays,
    currentMessage: input.currentMessage,
    pageContext: input.pageContext,
    conversationState: input.conversationState,
    relationshipState: input.relationshipState,
    conflictCount: Number(snapshot?.conflict_count) || 0,
  });
}

export async function recordGrowthRuntimeApplication(input: {
  db: SupabaseClient;
  ownerId: string;
  messageId: string;
  selection: GrowthRuntimeSelection;
}): Promise<void> {
  const selection = input.selection;
  if (!selection.activeGrowthVersion && !selection.temporaryOverlayIds.length) return;
  const { error } = await input.db.rpc("kiora_record_growth_application", {
    target_owner: input.ownerId,
    target_message_id: input.messageId,
    target_growth_version_id: selection.activeGrowthVersion?.id || null,
    target_snapshot_id: selection.snapshotId,
    applied_rule_ids: selection.appliedRuleIds,
    applied_overlay_ids: selection.temporaryOverlayIds,
    context_chars: selection.contextChars,
    estimated_tokens: selection.estimatedTokens,
    skipped_rule_count: selection.skippedRuleCount,
    conflict_count: selection.conflictCount,
  });
  if (error) throw new KioraRuntimeError("GROWTH_APPLICATION_RECORD_FAILED", 500);
}

export function growthRuntimePrompt(value?: GrowthRuntimeSelection | null): string {
  return value?.context || "GROWTH CONTEXT: disabled.";
}
