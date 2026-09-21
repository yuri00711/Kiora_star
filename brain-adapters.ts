import { KioraRuntimeError } from "../_shared/kiora-owner.ts";
import type { BrainRequest, BrainResult, JsonObject } from "./types.ts";

export interface BrainAdapter {
  complete(request: BrainRequest): Promise<BrainResult>;
}

function text(value: unknown, max = 500): string {
  const result = String(value ?? "").trim();
  if (result.length > max) throw new KioraRuntimeError("MODEL_CONFIG_INVALID", 500);
  return result;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function responseText(payload: JsonObject): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as JsonObject | undefined;
  const message = first?.message as JsonObject | undefined;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => part && typeof part === "object" ? String((part as JsonObject).text ?? "") : "")
      .join("")
      .trim();
  }
  return "";
}

class UnconfiguredAdapter implements BrainAdapter {
  async complete(): Promise<BrainResult> {
    throw new KioraRuntimeError("BRAIN_NOT_CONFIGURED", 503);
  }
}

class OpenAICompatibleAdapter implements BrainAdapter {
  async complete(request: BrainRequest): Promise<BrainResult> {
    const config = request.model.config || {};
    const secretName = text(config.api_key_env || "KIORA_BRAIN_API_KEY", 120);
    if (!/^KIORA_(?:BRAIN|PROVIDER_[A-Z0-9_]+)_API_KEY$/.test(secretName)) {
      throw new KioraRuntimeError("MODEL_CONFIG_INVALID", 500);
    }
    const apiKey = Deno.env.get(secretName);
    const baseUrl = text(config.base_url || Deno.env.get("KIORA_BRAIN_BASE_URL"), 1000).replace(/\/$/, "");
    const endpoint = text(config.endpoint || "/chat/completions", 300);
    const requiresApiKey = config.requires_api_key !== false;
    if (!baseUrl || (requiresApiKey && !apiKey)) throw new KioraRuntimeError("BRAIN_SECRET_MISSING", 503);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`, {
        method: "POST",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
  model: request.model.model_key,
  messages: request.messages,

  // DeepSeek Flash 默认开启 thinking。
  // Daily Brain 主要用于普通陪伴聊天，因此默认关闭，
  // 避免 reasoning 占用输出预算并导致 final content 为空。
  ...(request.model.model_key.startsWith("deepseek-")
    ? {
        thinking: {
          type: config.thinking === "enabled" ? "enabled" : "disabled",
        },
      }
    : {}),

  temperature: number(config.temperature, 0.8, 0, 2),
  max_tokens: Math.round(
    number(config.max_output_tokens, 800, 64, 4000)
  ),
}),
        signal: AbortSignal.timeout(Math.round(number(config.timeout_ms, 60000, 5000, 120000))),
      });
    } catch (error) {
      console.error("KIORA_PROVIDER_NETWORK_FAILED", error instanceof Error ? error.name : "UNKNOWN");
      throw new KioraRuntimeError("BRAIN_PROVIDER_UNAVAILABLE", 503);
    }

    const requestId = response.headers.get("x-request-id");
    if (!response.ok) {
      console.error("KIORA_PROVIDER_FAILED", response.status, requestId || "NO_REQUEST_ID");
      throw new KioraRuntimeError("BRAIN_PROVIDER_FAILED", 503);
    }

    let payload: JsonObject;
    try {
      payload = await response.json();
    } catch {
      throw new KioraRuntimeError("BRAIN_RESPONSE_INVALID", 502);
    }
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
const first = choices[0] as JsonObject | undefined;
const message = first?.message as JsonObject | undefined;

const content = responseText(payload);

if (!content) {
  const reasoningContent =
    typeof message?.reasoning_content === "string"
      ? message.reasoning_content
      : "";

  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : [];

  const finishReason =
    typeof first?.finish_reason === "string"
      ? first.finish_reason
      : "unknown";

  console.error("KIORA_PROVIDER_EMPTY_CONTENT", {
    provider: request.model.provider,
    model: request.model.model_key,
    finishReason,
    hasReasoning: Boolean(reasoningContent),
    hasToolCalls: toolCalls.length > 0,
    requestId: requestId || null,
  });

  throw new KioraRuntimeError("BRAIN_RESPONSE_INVALID", 502);
}
    const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as JsonObject : {};
    const reportedInput = Number(usage.prompt_tokens);
    const reportedOutput = Number(usage.completion_tokens);
    const inputTokens = Number.isFinite(reportedInput) && reportedInput >= 0
      ? reportedInput
      : Math.ceil(request.messages.reduce((sum, message) => sum + message.content.length, 0) / 3);
    const outputTokens = Number.isFinite(reportedOutput) && reportedOutput >= 0
      ? reportedOutput
      : Math.ceil(content.length / 3);
    return {
      content,
      inputTokens,
      outputTokens,
      requestId: text(payload.id || requestId || "", 500) || null,
      providerModel: text(payload.model || request.model.model_key, 500),
      usageMetadata: {
        ...usage,
        estimated: !(Number.isFinite(reportedInput) && reportedInput >= 0 && Number.isFinite(reportedOutput) && reportedOutput >= 0),
      },
    };
  }
}

const adapters: Record<string, BrainAdapter> = {
  unconfigured: new UnconfiguredAdapter(),
  none: new UnconfiguredAdapter(),
  "openai-compatible": new OpenAICompatibleAdapter(),
};

export function adapterFor(name: string): BrainAdapter {
  const adapter = adapters[name];
  if (!adapter) throw new KioraRuntimeError("BRAIN_ADAPTER_UNSUPPORTED", 503);
  return adapter;
}
