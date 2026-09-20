import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

export class KioraRuntimeError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

function serviceRoleKey(): string | null {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  try {
    const values = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return typeof values.default === "string" ? values.default : null;
  } catch {
    return null;
  }
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new KioraRuntimeError("AUTH_REQUIRED", 401);
  return match[1];
}

export type OwnerRuntimeContext = {
  owner: User;
  ownerId: string;
  db: SupabaseClient;
};

export async function requireKioraOwner(request: Request): Promise<OwnerRuntimeContext> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = serviceRoleKey();
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || serviceKey;
  if (!url || !serviceKey || !publicKey) {
    console.error("Missing required kiora-runtime Supabase environment variables");
    throw new KioraRuntimeError("SERVER_CONFIG_ERROR", 500);
  }

  const token = bearerToken(request);
  const authDb = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await authDb.auth.getUser(token);
  if (userError || !userData.user) throw new KioraRuntimeError("AUTH_REQUIRED", 401);

  const { data: isOwner, error: ownerError } = await authDb.rpc("is_site_owner");
  if (ownerError) {
    console.error("KIORA_OWNER_CHECK_FAILED", ownerError.code || "RPC_ERROR");
    throw new KioraRuntimeError("OWNER_CHECK_FAILED", 500);
  }
  if (isOwner !== true) throw new KioraRuntimeError("OWNER_REQUIRED", 403);

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { owner: userData.user, ownerId: userData.user.id, db };
}
