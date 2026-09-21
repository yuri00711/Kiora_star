import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { JsonObject } from "./types.ts";

function words(value: string): Set<string> {
  const normalized = value.toLowerCase().normalize("NFKC");
  const terms = normalized.match(/[a-z0-9_]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [];
  const result = new Set<string>();
  for (const term of terms) {
    if (/^[a-z0-9_]/.test(term)) {
      result.add(term);
      continue;
    }
    if (term.length === 1) result.add(term);
    for (let index = 0; index < term.length - 1; index += 1) result.add(term.slice(index, index + 2));
  }
  return result;
}

function sourceScore(links: any[]): number {
  const ranks: Record<string, number> = {
    official: 1.2, primary: 1, documentation: 1, news: 0.7,
    reference: 0.65, community: 0.35, social: 0.25, unknown: 0.1,
  };
  return Math.max(0, ...links.map((link) => {
    const source = link.kiora_sources || {};
    const relation = link.relation === "supports" ? 0.25 : link.relation === "contradicts" ? -0.4 : 0;
    return (ranks[String(source.source_type)] || 0) + relation;
  }));
}

export async function loadKnowledge(
  db: SupabaseClient,
  owner: string,
  query: string,
  page: JsonObject,
  config: JsonObject,
) {
  // This RPC only changes Knowledge state and emits a redacted lifecycle event.
  // It never copies external Knowledge into Memory.
  const staleResult = await db.rpc("kiora_mark_stale_knowledge", { target_owner: owner });
  if (staleResult.error) console.error("KIORA_KNOWLEDGE_STALENESS_FAILED");

  const visible = page.visible && typeof page.visible === "object" ? page.visible as JsonObject : {};
  const entityId = String(visible.entity_id || "");
  const { data, error } = await db.from("kiora_knowledge")
    .select("id,statement,summary,status,confidence,entity_type,entity_id,canonical_name,freshness_class,last_verified_at,corroboration_count,kiora_knowledge_sources(source_id,relation,relevant_excerpt,kiora_sources(title,domain,url,source_type,retrieved_at))")
    .eq("owner_id", owner)
    .in("status", ["active", "uncertain", "contested"])
    .order("last_verified_at", { ascending: false })
    .limit(Math.min(200, Number(config.knowledge_candidate_limit) || 120));
  if (error) return [];

  const queryWords = words(`${query} ${visible.title || visible.name || ""}`);
  return (data || []).map((knowledge: any) => {
    const knowledgeWords = words(`${knowledge.statement} ${knowledge.summary || ""} ${knowledge.canonical_name || ""}`);
    let overlap = 0;
    for (const word of knowledgeWords) {
      if (queryWords.has(word)) overlap += 1;
    }
    const semanticRelevance = overlap / Math.max(1, Math.min(queryWords.size, knowledgeWords.size));
    let score = overlap + semanticRelevance * 3;
    if (entityId && knowledge.entity_id === entityId) score += 8;
    const ageDays = Math.max(0, (Date.now() - new Date(knowledge.last_verified_at).getTime()) / 86_400_000);
    const recency = 1 / (1 + ageDays / 90);
    const stateWeight = knowledge.status === "active" ? 0.7 : knowledge.status === "uncertain" ? -0.25 : -0.6;
    const provenance = sourceScore(knowledge.kiora_knowledge_sources || []);
    return {
      ...knowledge,
      _score: score + stateWeight + provenance + recency +
        (Number(knowledge.confidence) || 0) * 2 +
        Math.min(5, Number(knowledge.corroboration_count) || 0) * 0.3,
    };
  }).filter((knowledge: any) => knowledge._score > 1)
    .sort((left: any, right: any) => right._score - left._score)
    .slice(0, Number(config.knowledge_retrieval_limit) || 6);
}

export function knowledgePrompt(rows: any[]): string {
  if (!rows.length) return "RELEVANT_KNOWLEDGE: none.";
  return `RELEVANT_KNOWLEDGE (external-world claims; never call these OWNER memories):
${rows.map((knowledge, index) => {
    const sources = (knowledge.kiora_knowledge_sources || []).slice(0, 4).map((link: any) => {
      const source = link.kiora_sources || {};
      return `${source.title || source.domain || "source"} <${source.url || ""}> [${source.source_type || "unknown"}]`;
    }).join("; ");
    return `${index + 1}. [${knowledge.status}; ${knowledge.freshness_class}; corroboration=${knowledge.corroboration_count || 0}] ${String(knowledge.summary || knowledge.statement).slice(0, 1_500)}
Sources: ${sources}`;
  }).join("\n")}`;
}
