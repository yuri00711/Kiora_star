import type { JsonObject } from "./types.ts";

export type ResearchDecision = {
  needed: boolean;
  explicit: boolean;
  depth: "quick" | "normal" | "deep";
  trigger: string;
  query: string;
  urls: string[];
  entity: JsonObject;
};

function minimalQuery(message: string, entityName: string, explicitSelection: string): string {
  let cleanedMessage = message
    .replace(/https?:\/\/[^\s<>"']+/gi, " ")
    .replace(/(请|麻烦你)?\s*(帮我)?\s*(联网|上网|网络)?\s*(查一下|查询|查找|搜索一下|搜索|调查|研究一下)/gi, " ")
    .replace(/(調べて|検索して|look up|search for|research)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  cleanedMessage = cleanedMessage
    .replace(/[，,。；;]?\s*(找出|告诉我|請告訴我|并把来源|並把來源|把来源|把來源|每条必须|每條必須|如果某条|如果某條).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  const deictic = /(这个|這個|这款|這款|这篇|這篇|这里|這裡|当前|當前|它|他|她|this|it|current)/i.test(message);
  const entityHint = deictic ? entityName : "";

  const selectedHint = explicitSelection.replace(/\s+/g, " ").trim().slice(0, 160);
  return [entityHint, cleanedMessage, selectedHint].filter(Boolean).join(" ").slice(0, 380);
}

export function routeResearch(message: string, page: JsonObject): ResearchDecision {
  const urls = [...message.matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((match) => match[0].replace(/[),。，]+$/, "")).slice(0, 5);
  const explicit = /(查一下|帮我查|搜索|调查|研究一下|調べて|検索して|look up|search for|research)/i.test(message) ||
    urls.length > 0;
  const temporal = /(最近|最新|今天|昨天|刚刚|现在|目前|today|yesterday|latest|recent|current|now)/i.test(message);
  const externalFact = /(消息|新闻|公告|官方|发售|延期|价格|更新|版本|政策|文档|news|announcement|official|release|delay|price|update|version|policy|documentation)/i.test(message);
  const freshnessRequired = temporal && externalFact;
  const visible = page.visible && typeof page.visible === "object" ? page.visible as JsonObject : {};
  const entityName = String(visible.title || visible.name || "").trim();
  const explicitSelection = typeof page.explicit_selection === "string" ? page.explicit_selection : "";
  const depth = /(深度|详细调查|deep research)/i.test(message) ? "deep" : explicit ? "normal" : "quick";
  return {
    needed: explicit || freshnessRequired,
    explicit,
    depth,
    trigger: urls.length ? "manual_url" : explicit ? "owner_explicit" : "freshness_required",
    query: minimalQuery(message, entityName, explicitSelection),
    urls,
    entity: {
      entity_type: visible.entity_type || null,
      entity_id: visible.entity_id || null,
      canonical_name: entityName || null,
    },
  };
}
