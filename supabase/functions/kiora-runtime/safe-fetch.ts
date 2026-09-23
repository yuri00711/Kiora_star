import { KioraRuntimeError } from "../_shared/kiora-owner.ts";
import { sanitizePostgresText } from "./postgres-sanitize.ts";
import { normalizeReadableText, readableBodyIsUsable } from "./research-material.ts";
import {
  literalAddressFamily,
  resolvedAddressSafetyBlock,
  staticUrlSafetyBlock,
  type AddressFamily,
  type UrlBlockReason,
  type UrlSafetyBlock,
} from "./research-url-policy.ts";
import type { JsonObject } from "./types.ts";

export class ResearchUrlBlockedError extends KioraRuntimeError {
  constructor(
    public blockReason: UrlBlockReason,
    public hostname: string,
    public addressFamily: AddressFamily,
  ) {
    super("RESEARCH_URL_BLOCKED", 400);
  }
}

export function researchUrlBlockReason(error: unknown): UrlBlockReason | null {
  return error instanceof ResearchUrlBlockedError ? error.blockReason : null;
}

function rejectUrl(block: UrlSafetyBlock): never {
  console.warn("KIORA_RESEARCH_URL_BLOCKED", {
    hostname: block.hostname,
    address_family: block.addressFamily,
    block_reason: block.blockReason,
  });
  throw new ResearchUrlBlockedError(block.blockReason, block.hostname, block.addressFamily);
}

export async function validatePublicUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KioraRuntimeError("RESEARCH_URL_INVALID", 400);
  }
  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const staticBlock = staticUrlSafetyBlock(url, projectUrl);
  if (staticBlock) rejectUrl(staticBlock);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const literalFamily = literalAddressFamily(host);
  if (!literalFamily) {
    if (typeof Deno.resolveDns !== "function") throw new KioraRuntimeError("RESEARCH_DNS_VALIDATION_UNAVAILABLE", 503);
    let resolvedCount = 0;
    for (const kind of ["A", "AAAA"] as const) {
      try {
        const addresses = await Deno.resolveDns(host.replace(/^\[|\]$/g, ""), kind);
        resolvedCount += addresses.length;
        for (const address of addresses) {
          const resolvedBlock = resolvedAddressSafetyBlock(host, address, kind === "A" ? "ipv4" : "ipv6");
          if (resolvedBlock) rejectUrl(resolvedBlock);
        }
      } catch (error) {
        if (error instanceof KioraRuntimeError) throw error;
        // A host can legitimately have only one address family.
      }
    }
    if (resolvedCount === 0) throw new KioraRuntimeError("RESEARCH_DNS_VALIDATION_FAILED", 502);
  }
  return url;
}

function decode(text: string): string {
  return sanitizePostgresText(text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, number) => {
      const codePoint = Number(number);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    }));
}

function meta(html: string, name: string): string {
  const expression = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
    "i",
  );
  const match = html.match(expression);
  return decode(match?.[1] || match?.[2] || "").trim();
}

export async function fetchReadable(rawUrl: string, config: JsonObject): Promise<JsonObject> {
  let url = await validatePublicUrl(rawUrl);
  const maxBytes = Math.min(2_000_000, Math.max(20_000, Number(config.max_fetch_bytes) || 750_000));
  const redirects = Math.min(5, Math.max(0, Number(config.max_redirects) || 3));
  for (let index = 0; index <= redirects; index += 1) {
    // Re-resolve immediately before each request and after every redirect.
    url = await validatePublicUrl(url.href);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "KioraResearch/1.0", Accept: "text/html,text/plain;q=0.9" },
        signal: AbortSignal.timeout(Math.min(30_000, Math.max(3_000, Number(config.timeout_ms) || 12_000))),
      });
    } catch {
      throw new KioraRuntimeError("RESEARCH_FETCH_FAILED", 502);
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next || index === redirects) throw new KioraRuntimeError("RESEARCH_REDIRECT_REJECTED", 502);
      url = await validatePublicUrl(new URL(next, url).href);
      continue;
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok) {
      throw new KioraRuntimeError(response.status === 429 ? "RESEARCH_PROVIDER_RATE_LIMITED" : "RESEARCH_FETCH_FAILED", 502);
    }
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new KioraRuntimeError("RESEARCH_CONTENT_TYPE_REJECTED", 415);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new KioraRuntimeError("RESEARCH_FETCH_FAILED", 502);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new KioraRuntimeError("RESEARCH_RESPONSE_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const html = new TextDecoder().decode(bytes);
    const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || meta(html, "og:title") || url.hostname)
      .replace(/\s+/g, " ").trim();
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1];
    let canonicalUrl = url.href;
    if (canonical) {
      try {
        canonicalUrl = (await validatePublicUrl(new URL(canonical, url).href)).href;
      } catch {
        canonicalUrl = url.href;
      }
    }
    const readableHtml = contentType.includes("text/plain")
      ? html
      : (html.match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/i)?.[1] ?? html);
    const cleaned = readableHtml
      .replace(/<(script|style|noscript|iframe|svg|nav|footer|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " ");
    const maxSourceChars = Math.min(80_000, Math.max(4_000, Number(config.max_source_chars) || 18_000));
    const text = normalizeReadableText(decode(cleaned), maxSourceChars);
    const minimumReadableChars = Math.min(500, Math.max(1, Number(config.min_readable_chars) || 40));
    if (!readableBodyIsUsable(text, minimumReadableChars)) {
      const diagnostic = text ? "RESEARCH_READABLE_TEXT_INSUFFICIENT" : "RESEARCH_READABLE_TEXT_EMPTY";
      console.warn(diagnostic, {
        domain: url.hostname,
        http_status: response.status,
        readable_char_count: text.length,
        minimum_readable_chars: minimumReadableChars,
      });
      throw new KioraRuntimeError(diagnostic, 422);
    }
    return {
      url: url.href,
      canonical_url: canonicalUrl,
      title,
      domain: url.hostname,
      publisher: meta(html, "og:site_name") || url.hostname,
      published_at: meta(html, "article:published_time") || null,
      content_type: contentType,
      http_status: response.status,
      readable_char_count: text.length,
      text,
    };
  }
  throw new KioraRuntimeError("RESEARCH_REDIRECT_REJECTED", 502);
}
