const encoder = new TextEncoder();
const decoder = new TextDecoder();

type EditorClaims = {
  role: "editor";
  sub: string;
  iat: number;
  exp: number;
};

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function issueEditorToken(
  subject: string,
  secret: string,
  ttlSeconds = 10 * 60 * 60,
): Promise<{ token: string; claims: EditorClaims }> {
  const now = Math.floor(Date.now() / 1000);
  const claims: EditorClaims = { role: "editor", sub: subject, iat: now, exp: now + ttlSeconds };
  const header = encodeBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const unsigned = `${header}.${payload}`;
  const signature = encodeBase64Url(await hmac(secret, unsigned));
  return { token: `${unsigned}.${signature}`, claims };
}

export async function verifyEditorToken(
  token: string,
  secret: string,
  expectedSubject: string,
): Promise<{ claims: EditorClaims | null; code?: string }> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { claims: null, code: "EDITOR_SESSION_INVALID" };
    const unsigned = `${parts[0]}.${parts[1]}`;
    const actual = decodeBase64Url(parts[2]);
    const expected = await hmac(secret, unsigned);
    if (!safeEqual(actual, expected)) return { claims: null, code: "EDITOR_SESSION_INVALID" };
    const header = JSON.parse(decoder.decode(decodeBase64Url(parts[0])));
    const claims = JSON.parse(decoder.decode(decodeBase64Url(parts[1]))) as EditorClaims;
    if (header?.alg !== "HS256" || header?.typ !== "JWT") return { claims: null, code: "EDITOR_SESSION_INVALID" };
    if (claims.role !== "editor" || claims.sub !== expectedSubject) return { claims: null, code: "EDITOR_SESSION_INVALID" };
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) || claims.iat > now + 60) {
      return { claims: null, code: "EDITOR_SESSION_INVALID" };
    }
    if (claims.exp <= now) return { claims: null, code: "EDITOR_SESSION_EXPIRED" };
    return { claims };
  } catch {
    return { claims: null, code: "EDITOR_SESSION_INVALID" };
  }
}

export function bearerToken(request: Request): string {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export function safeStringEqual(left: string, right: string): boolean {
  return safeEqual(encoder.encode(left), encoder.encode(right));
}
