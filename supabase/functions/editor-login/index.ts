import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { issueEditorToken, safeStringEqual } from "../_shared/editor-session.ts";

type Attempt = { count: number; resetAt: number };
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function attemptKey(request: Request, origin: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${origin}:${forwarded || "unknown"}`;
}

function blocked(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    if (entry) attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin") ?? "";
  const headers = corsHeaders(origin);
  if (!headers) return jsonResponse(origin, { success: false, code: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return jsonResponse(origin, { success: false, code: "METHOD_NOT_ALLOWED" }, 405);

  const key = attemptKey(request, origin);
  if (blocked(key)) return jsonResponse(origin, { success: false, code: "RATE_LIMITED" }, 429);

  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    body = value as Record<string, unknown>;
  } catch {
    return jsonResponse(origin, { success: false, code: "INVALID_REQUEST" }, 400);
  }

  const expectedId = Deno.env.get("EDITOR_LOGIN_ID");
  const expectedPassword = Deno.env.get("EDITOR_LOGIN_PASSWORD");
  const sessionSecret = Deno.env.get("EDITOR_SESSION_SECRET");
  if (!expectedId || !expectedPassword || !sessionSecret || sessionSecret.length < 32) {
    console.error("Missing required editor-login environment variables");
    return jsonResponse(origin, { success: false, code: "SERVER_CONFIG_ERROR" }, 500);
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!safeStringEqual(username, expectedId) || !safeStringEqual(password, expectedPassword)) {
    recordFailure(key);
    return jsonResponse(origin, { success: false, code: "INVALID_CREDENTIALS" }, 401);
  }

  attempts.delete(key);
  const { token, claims } = await issueEditorToken(expectedId, sessionSecret);
  return jsonResponse(origin, {
    success: true,
    token,
    token_type: "Bearer",
    identity: claims.sub,
    expires_at: claims.exp,
  });
});
