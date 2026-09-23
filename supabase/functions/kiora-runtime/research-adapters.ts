import { KioraRuntimeError } from "../_shared/kiora-owner.ts";
import { parseTavilyExtractPayload } from "./provider-extract.ts";
import { validatePublicUrl } from "./safe-fetch.ts";
import { sanitizePostgresText } from "./postgres-sanitize.ts";
import { staticUrlSafetyBlock } from "./research-url-policy.ts";
import type { JsonObject } from "./types.ts";

export type SearchResult = {
  url: string;
  title: string;
  snippet: string;
  rawContent: string;
};
export interface SearchAdapter {
  search(query: string, config: JsonObject, limit: number): Promise<{
    results: SearchResult[];
    requestId: string | null;
    cost: number;
  }>;
}

export type ProviderExtractResult = {
  requestedUrl: string;
  returnedUrl: string;
  rawContent: string;
  requestId: string | null;
  cost: number;
};

function at(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean)
    .reduce((current, key) => current && typeof current === "object" ? (current as JsonObject)[key] : undefined, value);
}

async function providerRequest(
  initialUrl: URL,
  headers: HeadersInit,
  config: JsonObject,
  init: Omit<RequestInit, "headers" | "redirect" | "signal"> = {},
): Promise<Response> {
  let url = initialUrl;
  const originalOrigin = initialUrl.origin;
  const maxRedirects = Math.min(3, Math.max(0, Number(config.search_max_redirects) || 1));
  for (let index = 0; index <= maxRedirects; index += 1) {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(Math.min(30_000, Math.max(3_000, Number(config.timeout_ms) || 12_000))),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || index === maxRedirects) throw new KioraRuntimeError("RESEARCH_PROVIDER_REDIRECT_REJECTED", 502);
    const next = await validatePublicUrl(new URL(location, url).href);
    // Authentication headers must never cross origins.
    if (next.origin !== originalOrigin) throw new KioraRuntimeError("RESEARCH_PROVIDER_REDIRECT_REJECTED", 502);
    url = next;
  }
  throw new KioraRuntimeError("RESEARCH_PROVIDER_REDIRECT_REJECTED", 502);
}

async function limitedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    throw new KioraRuntimeError("RESEARCH_PROVIDER_RESPONSE_INVALID", 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new KioraRuntimeError("RESEARCH_PROVIDER_RESPONSE_INVALID", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new KioraRuntimeError("RESEARCH_PROVIDER_RESPONSE_INVALID", 502);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new KioraRuntimeError("RESEARCH_PROVIDER_RESPONSE_INVALID", 502);
  }
}

function providerError(response: Response): KioraRuntimeError {
  if (response.status === 401 || response.status === 403) {
    return new KioraRuntimeError("RESEARCH_PROVIDER_AUTH_FAILED", 503);
  }
  if (response.status === 429) {
    return new KioraRuntimeError("RESEARCH_PROVIDER_RATE_LIMITED", 503);
  }
  // Tavily also uses 432/433 for plan / pay-as-you-go limits.
  if (response.status === 432 || response.status === 433) {
    return new KioraRuntimeError("RESEARCH_PROVIDER_BUDGET_EXHAUSTED", 503);
  }
  return new KioraRuntimeError("RESEARCH_PROVIDER_FAILED", 503);
}

export function providerExtractCost(config: JsonObject): number {
  return Math.max(0, Number(config.cost_per_extract ?? config.cost_per_query) || 0);
}

export async function extractWithTavily(
  rawUrl: string,
  config: JsonObject,
): Promise<ProviderExtractResult> {
  let requestedUrl: URL;
  try {
    requestedUrl = new URL(rawUrl);
  } catch {
    throw new KioraRuntimeError("RESEARCH_URL_INVALID", 400);
  }
  // Do not repeat DNS validation here: this method is specifically the safe
  // fallback for normal hostnames that Edge DNS can misclassify. Static SSRF
  // restrictions still run again before the URL reaches Tavily.
  if (staticUrlSafetyBlock(requestedUrl, Deno.env.get("SUPABASE_URL") || "")) {
    throw new KioraRuntimeError("RESEARCH_URL_BLOCKED", 400);
  }

  const apiKey = Deno.env.get("KIORA_PROVIDER_SEARCH_API_KEY");
  if (!apiKey) throw new KioraRuntimeError("RESEARCH_PROVIDER_NOT_CONFIGURED", 503);
  const extractDepth = String(config.extract_depth || "basic");
  if (!new Set(["basic", "advanced"]).has(extractDepth)) {
    throw new KioraRuntimeError("RESEARCH_PROVIDER_CONFIG_INVALID", 500);
  }
  const timeoutSeconds = Math.min(60, Math.max(1, Number(config.extract_timeout_seconds) || 20));
  const endpoint = new URL("https://api.tavily.com/extract");
  const response = await providerRequest(
    endpoint,
    {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    config,
    {
      method: "POST",
      body: JSON.stringify({
        urls: requestedUrl.href,
        extract_depth: extractDepth,
        include_images: false,
        include_favicon: false,
        format: "text",
        timeout: timeoutSeconds,
        include_usage: true,
      }),
    },
  );
  if (!response.ok) throw providerError(response);
  const payload = await limitedJson(
    response,
    Math.min(2_000_000, Math.max(20_000, Number(config.max_extract_bytes) || 750_000)),
  ) as JsonObject;
  const extracted = parseTavilyExtractPayload(
    payload,
    requestedUrl.href,
    Number(config.max_source_chars) || 18_000,
    Deno.env.get("SUPABASE_URL") || "",
  );
  if (!extracted) throw new KioraRuntimeError("RESEARCH_PROVIDER_EXTRACT_FAILED", 502);
  return {
    ...extracted,
    requestId: String(payload.request_id || response.headers.get("x-request-id") || "") || null,
    cost: providerExtractCost(config),
  };
}

class Unconfigured implements SearchAdapter {
  async search(): Promise<never> {
    throw new KioraRuntimeError("RESEARCH_PROVIDER_NOT_CONFIGURED", 503);
  }
}

class GenericJson implements SearchAdapter {
  async search(query: string, config: JsonObject, limit: number) {
    const endpoint = await validatePublicUrl(String(config.search_endpoint || ""));
    const envName = String(config.api_key_env || "KIORA_PROVIDER_SEARCH_API_KEY");
    if (!/^KIORA_PROVIDER_[A-Z0-9_]+_API_KEY$/.test(envName)) {
      throw new KioraRuntimeError("RESEARCH_PROVIDER_CONFIG_INVALID", 500);
    }
    const apiKey = Deno.env.get(envName);
    if (!apiKey) throw new KioraRuntimeError("RESEARCH_PROVIDER_NOT_CONFIGURED", 503);
    endpoint.searchParams.set(String(config.query_param || "q"), query);
    endpoint.searchParams.set(String(config.count_param || "count"), String(limit));
    const authHeader = String(config.auth_header || "Authorization");
    const authPrefix = String(config.auth_prefix ?? "Bearer ");
    const response = await providerRequest(endpoint, {
      [authHeader]: `${authPrefix}${apiKey}`,
      Accept: "application/json",
    }, config);
    if (!response.ok) throw providerError(response);
    const payload = await limitedJson(response, Math.min(2_000_000, Math.max(20_000, Number(config.max_search_bytes) || 500_000)));
    const rows = at(payload, String(config.results_path || "results"));
    if (!Array.isArray(rows)) throw new KioraRuntimeError("RESEARCH_PROVIDER_RESPONSE_INVALID", 502);
    const results: SearchResult[] = [];
    for (const row of rows.slice(0, limit)) {
      const candidate = row as JsonObject;
      const rawUrl = String(at(candidate, String(config.url_field || "url")) || "");
      try {
        const publicUrl = await validatePublicUrl(rawUrl);
        results.push({
          url: publicUrl.href,
          title: sanitizePostgresText(at(candidate, String(config.title_field || "title"))).slice(0, 1_000),
          snippet: sanitizePostgresText(at(candidate, String(config.snippet_field || "snippet"))).slice(0, 6_000),
          rawContent: sanitizePostgresText(at(candidate, String(config.raw_content_field || "raw_content")))
            .slice(0, Math.min(80_000, Math.max(4_000, Number(config.max_source_chars) || 18_000))),
        });
      } catch {
        // Unsafe discoveries are discarded before Fetch.
      }
    }
    const requestId = String(at(payload, String(config.request_id_path || "request_id")) || response.headers.get("x-request-id") || "") || null;
    return {
      results,
      requestId,
      cost: Math.max(0, Number(config.cost_per_query) || 0),
    };
  }
}

class Tavily implements SearchAdapter {
  async search(query: string, config: JsonObject, limit: number) {
    const endpoint = await validatePublicUrl(String(config.search_endpoint || "https://api.tavily.com/search"));
    const envName = String(config.api_key_env || "KIORA_PROVIDER_SEARCH_API_KEY");
    if (!/^KIORA_PROVIDER_[A-Z0-9_]+_API_KEY$/.test(envName)) {
      throw new KioraRuntimeError("RESEARCH_PROVIDER_CONFIG_INVALID", 500);
    }
    const apiKey = Deno.env.get(envName);
    if (!apiKey) throw new KioraRuntimeError("RESEARCH_PROVIDER_NOT_CONFIGURED", 503);

    const searchDepth = String(config.search_depth || "basic");
    if (!new Set(["basic", "advanced"]).has(searchDepth)) {
      throw new KioraRuntimeError("RESEARCH_PROVIDER_CONFIG_INVALID", 500);
    }

    const response = await providerRequest(
      endpoint,
      {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      config,
      {
        method: "POST",
        body: JSON.stringify({
          query,
          search_depth: searchDepth,
          max_results: Math.min(20, Math.max(1, Math.round(limit))),
          topic: String(config.search_topic || "general"),
          include_answer: false,
          // Tavily's current Search API contract accepts "text" here and returns
          // result.raw_content as provider-extracted page text.
          include_raw_content: "text",
          include_images: false,
          include_usage: true,
        }),
      },
    );

    if (!response.ok) throw providerError(response);

    const payload = await limitedJson(
      response,
      Math.min(2_000_000, Math.max(20_000, Number(config.max_search_bytes) || 500_000)),
    ) as JsonObject;
    const rows = payload.results;
    if (!Array.isArray(rows)) throw new KioraRuntimeError("RESEARCH_PROVIDER_RESPONSE_INVALID", 502);

    const results: SearchResult[] = [];
    for (const row of rows.slice(0, limit)) {
      const candidate = row as JsonObject;
      const rawUrl = String(candidate.url || "");
      try {
        const publicUrl = await validatePublicUrl(rawUrl);
        results.push({
          url: publicUrl.href,
          title: sanitizePostgresText(candidate.title).slice(0, 1_000),
          // Tavily result.content is relevant provider text, not the full page.
          snippet: sanitizePostgresText(candidate.content).slice(0, 6_000),
          rawContent: sanitizePostgresText(candidate.raw_content)
            .slice(0, Math.min(80_000, Math.max(4_000, Number(config.max_source_chars) || 18_000))),
        });
      } catch {
        // Unsafe discoveries are discarded before Fetch.
      }
    }

    return {
      results,
      requestId: String(payload.request_id || response.headers.get("x-request-id") || "") || null,
      // Keep this 0 while using Tavily's free monthly credits. If you move to PAYG,
      // set cost_per_query in research_config to your actual monetary cost per basic search.
      cost: Math.max(0, Number(config.cost_per_query) || 0),
    };
  }
}

const adapters: Record<string, SearchAdapter> = {
  unconfigured: new Unconfigured(),
  "generic-json": new GenericJson(),
  tavily: new Tavily(),
};

export function searchAdapter(name: string): SearchAdapter {
  return adapters[name] || adapters.unconfigured;
}
