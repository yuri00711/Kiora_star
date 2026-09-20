export type JsonObject = Record<string, unknown>;

export type ModelRecord = {
  id: string;
  owner_id: string;
  brain_role: "daily" | "deep" | "research" | "embedding" | "reranker";
  provider: string;
  model_key: string;
  runtime: string;
  adapter: string;
  version: string;
  status: string;
  is_local: boolean;
  cost_config: JsonObject;
  capabilities: JsonObject;
  config: JsonObject;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type BrainRequest = {
  model: ModelRecord;
  messages: ChatMessage[];
};

export type BrainResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  requestId: string | null;
  providerModel: string;
  usageMetadata: JsonObject;
};

export type CostResult = {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
  snapshot: JsonObject;
};
