import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://kiora.space",
  "https://www.kiora.space",
]);

const encoder = new TextEncoder();

function corsHeaders(origin: string): Record<string, string> | null {
  if (!ALLOWED_ORIGINS.has(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(
  origin: string,
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(corsHeaders(origin) ?? { "Vary": "Origin" }),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin") ?? "";
  const headers = corsHeaders(origin);

  if (!headers) {
    return jsonResponse(origin, { success: false, error: "Origin not allowed" }, 403);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return jsonResponse(origin, { success: false, error: "Method not allowed" }, 405);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(origin, { success: false, error: "Invalid request" }, 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse(origin, { success: false, error: "Invalid request" }, 400);
  }

  const credentials = payload as { username?: unknown; password?: unknown };

  const username =
    typeof credentials.username === "string" ? credentials.username.trim() : "";
  const password =
    typeof credentials.password === "string" ? credentials.password : "";

  if (!username || !password) {
    return jsonResponse(origin, { success: false, error: "Invalid request" }, 400);
  }

  const expectedId = Deno.env.get("ADMIN_LOGIN_ID");
  const expectedPin = Deno.env.get("ADMIN_LOGIN_PIN");
  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  const adminPassword = Deno.env.get("ADMIN_REAL_PASSWORD");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (
    !expectedId ||
    !expectedPin ||
    !adminEmail ||
    !adminPassword ||
    !supabaseUrl ||
    !supabaseAnonKey
  ) {
    console.error("admin-login is missing required environment variables");
    return jsonResponse(origin, { success: false, error: "Login service unavailable" }, 500);
  }

  if (!safeEqual(username, expectedId) || !safeEqual(password, expectedPin)) {
    return jsonResponse(origin, { success: false, error: "Invalid credentials" }, 401);
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  let authResult;

  try {
    authResult = await authClient.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });
  } catch (error) {
    console.error("admin-login request to Supabase Auth failed", error);
    return jsonResponse(origin, { success: false, error: "Login service unavailable" }, 500);
  }

  const { data, error } = authResult;

  if (error || !data.session) {
    console.error("admin-login could not create the administrator session", error);
    return jsonResponse(origin, { success: false, error: "Login service unavailable" }, 500);
  }

  return jsonResponse(
    origin,
    {
      success: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
    200,
  );
});
