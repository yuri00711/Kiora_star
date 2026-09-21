import { KioraRuntimeError } from "../_shared/kiora-owner.ts";
import type { JsonObject } from "./types.ts";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

function privateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && (parts[1] === 0 || parts[1] === 88 || parts[1] === 168)) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
    parts[0] >= 224;
}

function ipv6Groups(input: string): number[] | null {
  let value = input.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!value.includes(":")) return null;
  const ipv4 = value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4) {
    const bytes = ipv4.split(".").map(Number);
    if (bytes.length !== 4 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
    value = value.slice(0, value.length - ipv4.length) +
      `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 1 && halves.length === 2) return null;
  const groups = [...left, ...Array(fill).fill("0"), ...right].map((part) => Number.parseInt(part || "0", 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

function privateV6(ip: string): boolean {
  const groups = ipv6Groups(ip);
  if (!groups) return false;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
  if ((groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xff00) === 0xff00) return true;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return privateV4(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`);
  }
  return false;
}

export async function validatePublicUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KioraRuntimeError("RESEARCH_URL_INVALID", 400);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new KioraRuntimeError("RESEARCH_URL_BLOCKED", 400);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  let projectHost = "";
  try {
    projectHost = new URL(Deno.env.get("SUPABASE_URL") || "").hostname.toLowerCase();
  } catch {
    // An absent/invalid project URL is handled by owner authentication.
  }
  if (
    BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") ||
    host === projectHost || privateV4(host) || privateV6(host)
  ) {
    throw new KioraRuntimeError("RESEARCH_URL_BLOCKED", 400);
  }
  const literalAddress = privateV4(host) || ipv6Groups(host) !== null || /^\d+(?:\.\d+){3}$/.test(host);
  if (!literalAddress) {
    if (typeof Deno.resolveDns !== "function") throw new KioraRuntimeError("RESEARCH_DNS_VALIDATION_UNAVAILABLE", 503);
    let resolvedCount = 0;
    for (const kind of ["A", "AAAA"] as const) {
      try {
        const addresses = await Deno.resolveDns(host.replace(/^\[|\]$/g, ""), kind);
        resolvedCount += addresses.length;
        for (const address of addresses) {
          if (privateV4(address) || privateV6(address)) throw new KioraRuntimeError("RESEARCH_URL_BLOCKED", 400);
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
  return text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, number) => {
      const codePoint = Number(number);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    });
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
    const cleaned = html
      .replace(/<(script|style|noscript|iframe|svg|nav|footer|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " ");
    const text = decode(cleaned).replace(/\s+/g, " ").trim()
      .slice(0, Math.min(80_000, Math.max(4_000, Number(config.max_source_chars) || 18_000)));
    return {
      url: url.href,
      canonical_url: canonicalUrl,
      title,
      domain: url.hostname,
      publisher: meta(html, "og:site_name") || url.hostname,
      published_at: meta(html, "article:published_time") || null,
      content_type: contentType,
      http_status: response.status,
      text,
    };
  }
  throw new KioraRuntimeError("RESEARCH_REDIRECT_REJECTED", 502);
}
