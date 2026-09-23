import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const policy = await import(new URL("supabase/functions/kiora-runtime/research-url-policy.ts", root).href);
const extract = await import(new URL("supabase/functions/kiora-runtime/provider-extract.ts", root).href);
const material = await import(new URL("supabase/functions/kiora-runtime/research-material.ts", root).href);
const safeFetch = await readFile(new URL("supabase/functions/kiora-runtime/safe-fetch.ts", root), "utf8");
const adapters = await readFile(new URL("supabase/functions/kiora-runtime/research-adapters.ts", root), "utf8");
const research = await readFile(new URL("supabase/functions/kiora-runtime/research.ts", root), "utf8");

const projectUrl = "https://project-ref.supabase.co";
const publicUrl = new URL("https://ayakasigohan-edia.com/");
assert.equal(policy.staticUrlSafetyBlock(publicUrl, projectUrl), null);
assert.deepEqual(
  policy.resolvedAddressSafetyBlock(publicUrl.hostname, "10.0.0.8", "ipv4"),
  {
    hostname: publicUrl.hostname,
    addressFamily: "ipv4",
    blockReason: "dns_resolved_nonpublic",
  },
  "a nonpublic Edge DNS answer must keep its internal fallback-eligible reason",
);
assert.equal(policy.resolvedAddressSafetyBlock(publicUrl.hostname, "93.184.216.34", "ipv4"), null);
assert.equal(policy.shouldAttemptProviderExtract({
  explicitUrl: true,
  directFailureCode: "",
  directBlockReason: null,
}), false, "a successful direct fetch must not invoke Tavily Extract");
assert.equal(policy.shouldAttemptProviderExtract({
  explicitUrl: true,
  directFailureCode: "RESEARCH_URL_BLOCKED",
  directBlockReason: "dns_resolved_nonpublic",
}), true, "an Edge DNS nonpublic result may use provider extraction");
assert.equal(policy.shouldAttemptProviderExtract({
  explicitUrl: true,
  directFailureCode: "RESEARCH_READABLE_TEXT_EMPTY",
  directBlockReason: null,
}), true, "empty direct text may use provider extraction");
assert.equal(policy.shouldAttemptProviderExtract({
  explicitUrl: true,
  directFailureCode: "RESEARCH_FETCH_FAILED",
  directBlockReason: null,
  literalAddress: true,
}), false, "provider extraction is reserved for normal public hostnames, not literal IPs");

const forbidden = [
  ["http://localhost/", "blocked_hostname"],
  ["http://service.internal/", "blocked_hostname"],
  ["http://127.0.0.1/", "literal_private_ip"],
  ["http://[fd00::1]/", "literal_private_ip"],
  [`${projectUrl}/storage/v1/object/private`, "project_host"],
  ["https://user:password@example.com/", "url_credentials"],
  ["ftp://example.com/file", "unsupported_protocol"],
];
for (const [url, reason] of forbidden) {
  const block = policy.staticUrlSafetyBlock(new URL(url), projectUrl);
  assert.equal(block?.blockReason, reason, `${url} must remain blocked`);
  assert.equal(policy.shouldAttemptProviderExtract({
    explicitUrl: true,
    directFailureCode: "RESEARCH_URL_BLOCKED",
    directBlockReason: block?.blockReason,
  }), false, `${url} must never reach Tavily Extract`);
}

const unicodePayload = {
  results: [{
    url: "https://ayakasigohan-edia.com/",
    raw_content: "中\u0000文 日本語 😀 A\ud800B\udfffC\u0002D",
  }],
  failed_results: [],
};
const parsed = extract.parseTavilyExtractPayload(
  unicodePayload,
  "https://ayakasigohan-edia.com/",
  18_000,
  projectUrl,
);
assert.ok(parsed);
assert.equal(parsed.rawContent, "中文 日本語 😀 A�B�CD");
assert.equal(parsed.returnedUrl, "https://ayakasigohan-edia.com/");
assert.equal(policy.providerExtractUrlEquivalent(
  "http://ayakasigohan-edia.com/",
  "https://ayakasigohan-edia.com/",
  projectUrl,
), true, "a same-host HTTPS canonical upgrade is accepted");
assert.equal(policy.providerExtractUrlEquivalent(
  "https://ayakasigohan-edia.com/",
  "https://www.ayakasigohan-edia.com/",
  projectUrl,
), false, "an unverified hostname change is rejected");
assert.equal(extract.parseTavilyExtractPayload(
  { results: [{ url: "https://unrelated.example/", raw_content: "wrong page" }] },
  "https://ayakasigohan-edia.com/",
  18_000,
  projectUrl,
), null, "another page can never substitute for the requested URL");
assert.equal(extract.parseTavilyExtractPayload(
  { results: [], failed_results: [{ url: publicUrl.href, error: "failed" }] },
  publicUrl.href,
  18_000,
  projectUrl,
), null, "a failed Tavily extraction yields no readable provider body");
assert.equal(material.selectResearchMaterial({ providerRawContent: null }), null,
  "failed direct and provider extraction must end as no readable content");

assert.match(safeFetch, /class ResearchUrlBlockedError extends KioraRuntimeError/);
assert.match(safeFetch, /block_reason:\s*block\.blockReason/);
assert.match(safeFetch, /resolvedAddressSafetyBlock/);
assert.match(adapters, /new URL\("https:\/\/api\.tavily\.com\/extract"\)/);
assert.match(adapters, /Deno\.env\.get\("KIORA_PROVIDER_SEARCH_API_KEY"\)/);
assert.match(adapters, /urls:\s*requestedUrl\.href/);
assert.match(adapters, /format:\s*"text"/);
assert.match(adapters, /parseTavilyExtractPayload/);
assert.match(research, /const fallback = explicitUrlResearch \? null : selectResearchMaterial/,
  "explicit URLs must never fall back to a search snippet");
assert.match(research, /retrieval_method:\s*"provider_extract"/);
assert.match(research, /provider:\s*"tavily"/);
assert.match(research, /requested_url:\s*extracted\.requestedUrl/);
assert.match(research, /returned_url:\s*extracted\.returnedUrl/);
assert.match(research, /KIORA_DIRECT_FETCH_FALLBACK/);
assert.match(research, /provider_extract_attempted:\s*providerExtractAttempted/);
assert.match(research, /provider_extract_succeeded:\s*providerExtractSucceeded/);
assert.match(research, /extracted_chars:\s*providerExtractedChars/);

console.log("Phase 3 direct URL SSRF policy and Tavily Extract fallback checks passed.");
