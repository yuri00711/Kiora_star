export type UrlBlockReason =
  | "blocked_hostname"
  | "literal_private_ip"
  | "project_host"
  | "dns_resolved_nonpublic"
  | "url_credentials"
  | "unsupported_protocol";

export type AddressFamily = "ipv4" | "ipv6" | "hostname" | null;

export type UrlSafetyBlock = {
  hostname: string;
  addressFamily: AddressFamily;
  blockReason: UrlBlockReason;
};

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);
const PROVIDER_EXTRACT_FAILURES = new Set([
  "RESEARCH_FETCH_FAILED",
  "RESEARCH_REDIRECT_REJECTED",
  "RESEARCH_CONTENT_TYPE_REJECTED",
  "RESEARCH_RESPONSE_TOO_LARGE",
  "RESEARCH_READABLE_TEXT_EMPTY",
  "RESEARCH_READABLE_TEXT_INSUFFICIENT",
]);

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

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
  let value = normalizedHostname(input).split("%")[0];
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

export function literalAddressFamily(hostname: string): AddressFamily {
  const host = normalizedHostname(hostname);
  if (/^\d+(?:\.\d+){3}$/.test(host)) return "ipv4";
  if (ipv6Groups(host) !== null) return "ipv6";
  return null;
}

export function urlUsesLiteralAddress(value: string): boolean {
  try {
    return literalAddressFamily(new URL(value).hostname) !== null;
  } catch {
    return false;
  }
}

export function addressIsNonpublic(address: string): boolean {
  const family = literalAddressFamily(address);
  return family === "ipv4" ? privateV4(normalizedHostname(address))
    : family === "ipv6" ? privateV6(normalizedHostname(address))
    : true;
}

export function resolvedAddressSafetyBlock(
  hostname: string,
  address: string,
  addressFamily: "ipv4" | "ipv6",
): UrlSafetyBlock | null {
  return addressIsNonpublic(address)
    ? { hostname: normalizedHostname(hostname), addressFamily, blockReason: "dns_resolved_nonpublic" }
    : null;
}

export function staticUrlSafetyBlock(url: URL, projectUrl = ""): UrlSafetyBlock | null {
  const hostname = normalizedHostname(url.hostname);
  if (!["http:", "https:"].includes(url.protocol)) {
    return { hostname, addressFamily: literalAddressFamily(hostname) || "hostname", blockReason: "unsupported_protocol" };
  }
  if (url.username || url.password) {
    return { hostname, addressFamily: literalAddressFamily(hostname) || "hostname", blockReason: "url_credentials" };
  }
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    return { hostname, addressFamily: "hostname", blockReason: "blocked_hostname" };
  }
  let projectHost = "";
  try {
    projectHost = normalizedHostname(new URL(projectUrl).hostname);
  } catch {
    projectHost = "";
  }
  if (projectHost && hostname === projectHost) {
    return { hostname, addressFamily: "hostname", blockReason: "project_host" };
  }
  const family = literalAddressFamily(hostname);
  if ((family === "ipv4" && privateV4(hostname)) || (family === "ipv6" && privateV6(hostname))) {
    return { hostname, addressFamily: family, blockReason: "literal_private_ip" };
  }
  return null;
}

function comparablePath(pathname: string): string {
  const normalized = pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

export function providerExtractUrlEquivalent(requestedValue: string, returnedValue: string, projectUrl = ""): boolean {
  let requested: URL;
  let returned: URL;
  try {
    requested = new URL(requestedValue);
    returned = new URL(returnedValue);
  } catch {
    return false;
  }
  if (staticUrlSafetyBlock(requested, projectUrl) || staticUrlSafetyBlock(returned, projectUrl)) return false;
  if (normalizedHostname(requested.hostname) !== normalizedHostname(returned.hostname)) return false;
  if (requested.protocol !== returned.protocol && !(requested.protocol === "http:" && returned.protocol === "https:")) {
    return false;
  }
  if (requested.port !== returned.port) return false;
  if (comparablePath(requested.pathname) !== comparablePath(returned.pathname)) return false;
  return requested.search === returned.search;
}

export function shouldAttemptProviderExtract(input: {
  explicitUrl: boolean;
  directFailureCode: string;
  directBlockReason?: UrlBlockReason | null;
  literalAddress?: boolean;
}): boolean {
  if (!input.explicitUrl || input.literalAddress === true) return false;
  if (input.directFailureCode === "RESEARCH_URL_BLOCKED") {
    return input.directBlockReason === "dns_resolved_nonpublic";
  }
  return PROVIDER_EXTRACT_FAILURES.has(input.directFailureCode);
}
