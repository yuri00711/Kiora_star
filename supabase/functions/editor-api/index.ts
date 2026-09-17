import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { bearerToken, verifyEditorToken } from "../_shared/editor-session.ts";

type JsonObject = Record<string, unknown>;
type ActionContext = { db: SupabaseClient; payload: JsonObject; ownerId: string | null };

const ACTIONS = new Set([
  "session_status",
  "writing_list",
  "writing_get",
  "profile_update",
  "profile_item_create",
  "profile_item_update",
  "otome_update",
  "writing_create",
  "writing_update",
  "writing_pin",
  "game_create",
  "game_update",
  "game_repo_get",
  "game_repo_upsert",
  "character_create",
  "character_update",
  "music_create",
  "music_update",
  "currently_playing_update",
  "tier_board_create",
  "tier_board_update",
  "tier_section_create",
  "tier_section_update",
  "tier_sections_reorder",
  "tier_item_move",
  "tier_items_reorder",
  "upload_site_media",
]);

const ACTION_PAYLOAD_FIELDS: Record<string, string[]> = {
  writing_list: [], writing_get: ["id"], profile_update: ["data"],
  profile_item_create: ["kind", "data"], profile_item_update: ["kind", "id", "data"],
  otome_update: ["data"], writing_create: ["data"], writing_update: ["id", "data"],
  writing_pin: ["id", "is_pinned"], game_create: ["data"], game_update: ["id", "data"],
  game_repo_get: ["game_id"], game_repo_upsert: ["game_id", "config"],
  character_create: ["data"], character_update: ["id", "data"], music_create: ["data"],
  music_update: ["id", "data"], currently_playing_update: ["data"],
  tier_board_create: ["title", "description", "sort_order"],
  tier_board_update: ["id", "title", "description"],
  tier_section_create: ["board_id", "title", "description", "sort_order"],
  tier_section_update: ["id", "title", "description"], tier_sections_reorder: ["items"],
  tier_item_move: ["id", "board_id", "section_id", "game_id", "sort_order"],
  tier_items_reorder: ["items"], upload_site_media: ["path", "content_type", "base64"],
};

const PROFILE_FIELDS = ["nickname", "avatar_url", "tagline", "summary", "about_text", "free_space_title", "free_space_content"];
const WRITING_FIELDS = ["title", "subtitle", "body", "category", "published_at", "cover_url", "tags", "is_pinned", "is_public", "excerpt", "sort_order"];
const GAME_FIELDS = ["title", "review", "rating", "cover_url", "sort_order", "started_at", "completed_at", "status", "favorite_level", "platforms", "tags", "official_site_url", "store_links"];
const CHARACTER_FIELDS = ["game_id", "name", "subtitle", "review", "rating", "image_url", "sort_order"];
const MUSIC_FIELDS = ["title", "artist", "cover_url", "music_url", "provider", "note", "lyric_excerpt", "lrc_data", "sort_order"];

function serverKey(): string | null {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const values = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return typeof values.default === "string" ? values.default : null;
  } catch {
    return null;
  }
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PAYLOAD");
  return value as JsonObject;
}

function only(source: JsonObject, allowed: string[]): JsonObject {
  const unknown = Object.keys(source).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error("INVALID_PAYLOAD");
  return Object.fromEntries(allowed.filter((key) => key in source).map((key) => [key, source[key]]));
}

function id(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("INVALID_PAYLOAD");
  return parsed;
}

function ownerUuid(value: string | null): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("SERVER_CONFIG_ERROR");
  }
  return value;
}

function requiredText(value: unknown, max = 10000): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new Error("INVALID_PAYLOAD");
  return text;
}

function nullableText(value: unknown, max = 50000): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (text.length > max) throw new Error("INVALID_PAYLOAD");
  return text;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("INVALID_PAYLOAD");
  return parsed;
}

function pureDateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("INVALID_PAYLOAD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("INVALID_PAYLOAD");
  return text;
}

function textArray(value: unknown, maxItems = 100): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error("INVALID_PAYLOAD");
  return value.map((item) => requiredText(item, 120));
}

function urlOrNull(value: unknown): string | null {
  const text = nullableText(value, 2048);
  if (!text) return null;
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("INVALID_PAYLOAD");
  return url.href;
}

function normalizeProfile(data: JsonObject): JsonObject {
  const value = only(data, ["id", ...PROFILE_FIELDS]);
  delete value.id;
  for (const key of PROFILE_FIELDS) value[key] = key === "avatar_url" ? urlOrNull(value[key]) : nullableText(value[key]);
  return { id: 1, ...value };
}

function normalizeWriting(data: JsonObject): JsonObject {
  const value = only(data, WRITING_FIELDS);
  const category = String(value.category ?? "");
  if (!["game_review", "essay", "dream", "archive"].includes(category)) throw new Error("INVALID_PAYLOAD");
  const published = new Date(String(value.published_at ?? ""));
  if (!Number.isFinite(published.getTime())) throw new Error("INVALID_PAYLOAD");
  return {
    title: requiredText(value.title, 240),
    subtitle: nullableText(value.subtitle, 500),
    body: requiredText(value.body, 500000),
    category,
    published_at: published.toISOString(),
    cover_url: urlOrNull(value.cover_url),
    tags: textArray(value.tags ?? []),
    is_pinned: Boolean(value.is_pinned),
    is_public: value.is_public !== false,
    excerpt: nullableText(value.excerpt, 2000),
    sort_order: optionalNumber(value.sort_order),
  };
}

function normalizeGame(data: JsonObject): JsonObject {
  const value = only(data, GAME_FIELDS);
  const status = nullableText(value.status, 40);
  const favorite = nullableText(value.favorite_level, 40);
  const startedAt = pureDateOrNull(value.started_at);
  const completedAt = pureDateOrNull(value.completed_at);
  if (status && !["PLAYING", "COMPLETED", "PAUSED", "DROPPED", "WISHLIST"].includes(status)) throw new Error("INVALID_PAYLOAD");
  if (favorite && !["FAVORITE", "BELOVED", "LOVE", "LIKE", "NEUTRAL", "NOT FOR ME"].includes(favorite)) throw new Error("INVALID_PAYLOAD");
  if (startedAt && completedAt && completedAt < startedAt) throw new Error("INVALID_PAYLOAD");
  const links = Array.isArray(value.store_links) ? value.store_links.map((entry) => {
    const item = only(object(entry), ["label", "url"]);
    return { label: requiredText(item.label, 80), url: urlOrNull(item.url) };
  }).filter((entry) => entry.url) : [];
  return {
    title: requiredText(value.title, 240),
    review: nullableText(value.review, 200000),
    rating: optionalNumber(value.rating),
    cover_url: urlOrNull(value.cover_url),
    sort_order: optionalNumber(value.sort_order),
    started_at: startedAt,
    completed_at: completedAt,
    status,
    favorite_level: favorite,
    platforms: textArray(value.platforms ?? [], 20),
    tags: textArray(value.tags ?? []),
    official_site_url: urlOrNull(value.official_site_url),
    store_links: links,
  };
}

function normalizeCharacter(data: JsonObject): JsonObject {
  const value = only(data, CHARACTER_FIELDS);
  return {
    game_id: id(value.game_id),
    name: requiredText(value.name, 240),
    subtitle: nullableText(value.subtitle, 500),
    review: nullableText(value.review, 200000),
    rating: optionalNumber(value.rating),
    image_url: urlOrNull(value.image_url),
    sort_order: optionalNumber(value.sort_order),
  };
}

function normalizeRepoConfig(data: JsonObject): JsonObject {
  const fields = [
    "title", "cover_url", "started_at", "completed_at", "play_time", "platform", "language", "completion",
    "played_because", "profile", "favorites", "my_favorite", "note", "review_title", "review_route",
    "review_keywords", "long_review", "visibility", "layout", "cover_position", "favorite_position"
  ];
  const value = only(data, fields);
  const encoded = JSON.stringify(value);
  if (encoded.length > 500_000) throw new Error("INVALID_PAYLOAD");
  value.title = nullableText(value.title, 240);
  value.cover_url = urlOrNull(value.cover_url);
  value.started_at = pureDateOrNull(value.started_at);
  value.completed_at = pureDateOrNull(value.completed_at);
  value.play_time = nullableText(value.play_time, 80);
  value.platform = nullableText(value.platform, 80);
  value.language = nullableText(value.language, 80);
  value.completion = nullableText(value.completion, 80);
  value.played_because = nullableText(value.played_because, 1000);
  value.note = nullableText(value.note, 5000);
  value.review_title = nullableText(value.review_title, 240);
  value.review_route = nullableText(value.review_route, 500);
  value.long_review = nullableText(value.long_review, 200000);
  value.review_keywords = textArray(value.review_keywords ?? [], 30);
  return value;
}

function normalizeMusic(data: JsonObject): JsonObject {
  const value = only(data, MUSIC_FIELDS);
  const provider = String(value.provider ?? "");
  if (!["netease", "spotify", "youtube", "apple_music"].includes(provider)) throw new Error("INVALID_PAYLOAD");
  return {
    title: requiredText(value.title, 240),
    artist: nullableText(value.artist, 240),
    cover_url: urlOrNull(value.cover_url),
    music_url: urlOrNull(value.music_url) || (() => { throw new Error("INVALID_PAYLOAD"); })(),
    provider,
    note: nullableText(value.note, 10000),
    lyric_excerpt: nullableText(value.lyric_excerpt, 10000),
    lrc_data: nullableText(value.lrc_data, 200000),
    sort_order: optionalNumber(value.sort_order),
  };
}

async function execute(action: string, context: ActionContext): Promise<unknown> {
  const { db, ownerId } = context;
  const payload = only(context.payload, ACTION_PAYLOAD_FIELDS[action] || []);
  let result: { data: unknown; error: { message?: string; code?: string } | null };

  switch (action) {
    case "writing_list":
      result = await db.from("writings").select("*").order("is_pinned", { ascending: false }).order("sort_order", { ascending: true, nullsFirst: false }).order("published_at", { ascending: false });
      break;
    case "writing_get":
      result = await db.from("writings").select("*").eq("id", id(payload.id)).maybeSingle();
      break;
    case "profile_update":
      result = await db.from("site_profile").upsert(normalizeProfile(object(payload.data)), { onConflict: "id" }).select("id").single();
      break;
    case "profile_item_create":
    case "profile_item_update": {
      const kind = String(payload.kind ?? "");
      const config: Record<string, { table: string; fields: string[] }> = {
        fandom: { table: "profile_fandoms", fields: ["name", "image_url", "description", "status", "sort_order"] },
        favorite: { table: "profile_favorites", fields: ["name", "work_name", "image_url", "favorite_level", "note", "symbol", "sort_order"] },
        boundary: { table: "profile_boundaries", fields: ["label", "kind", "sort_order"] },
      };
      const selected = config[kind];
      if (!selected) throw new Error("INVALID_PAYLOAD");
      const data = only(object(payload.data), selected.fields);
      if (kind === "fandom") {
        data.name = requiredText(data.name, 120); data.image_url = urlOrNull(data.image_url); data.description = nullableText(data.description, 5000);
        if (!["CURRENT", "LONG TERM", "OCCASIONAL", "CLOSED"].includes(String(data.status))) throw new Error("INVALID_PAYLOAD");
      } else if (kind === "favorite") {
        data.name = requiredText(data.name, 120); data.work_name = nullableText(data.work_name, 240); data.image_url = urlOrNull(data.image_url);
        data.note = nullableText(data.note, 5000); data.symbol = nullableText(data.symbol, 4);
        if (!["最推", "推", "好感"].includes(String(data.favorite_level))) throw new Error("INVALID_PAYLOAD");
      } else {
        data.label = requiredText(data.label, 240);
        if (!["雷点", "苦手", "不太感兴趣"].includes(String(data.kind))) throw new Error("INVALID_PAYLOAD");
      }
      data.sort_order = optionalNumber(data.sort_order);
      result = action.endsWith("create")
        ? await db.from(selected.table).insert(data).select("id").single()
        : await db.from(selected.table).update(data).eq("id", id(payload.id)).select("id").single();
      break;
    }
    case "otome_update": {
      const value = only(object(payload.data), ["id", "axes", "play_styles", "favorite_elements", "not_my_type"]);
      if (!Array.isArray(value.axes) || value.axes.length > 30) throw new Error("INVALID_PAYLOAD");
      const axes = value.axes.map((axis) => {
        const item = only(object(axis), ["left", "right", "value"]);
        const score = Number(item.value);
        if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error("INVALID_PAYLOAD");
        return { left: requiredText(item.left, 80), right: requiredText(item.right, 80), value: score };
      });
      result = await db.from("otome_profile").upsert({ id: 1, axes, play_styles: textArray(value.play_styles ?? []), favorite_elements: textArray(value.favorite_elements ?? []), not_my_type: textArray(value.not_my_type ?? []) }, { onConflict: "id" }).select("id").single();
      break;
    }
    case "writing_create":
      result = await db.from("writings").insert(normalizeWriting(object(payload.data))).select("id").single();
      break;
    case "writing_update":
      result = await db.from("writings").update(normalizeWriting(object(payload.data))).eq("id", id(payload.id)).select("id").single();
      break;
    case "writing_pin":
      result = await db.from("writings").update({ is_pinned: Boolean(payload.is_pinned) }).eq("id", id(payload.id)).select("id").single();
      break;
    case "game_create":
      result = await db.from("games").insert(normalizeGame(object(payload.data))).select("id").single();
      break;
    case "game_update":
      result = await db.from("games").update(normalizeGame(object(payload.data))).eq("id", id(payload.id)).select("id").single();
      break;
    case "game_repo_get":
      result = await db.from("game_repo").select("id,game_id,config,updated_at").eq("game_id", id(payload.game_id)).maybeSingle();
      break;
    case "game_repo_upsert":
      result = await db.from("game_repo").upsert({ game_id: id(payload.game_id), owner_id: ownerUuid(ownerId), config: normalizeRepoConfig(object(payload.config)) }, { onConflict: "game_id" }).select("id,game_id,config,updated_at").single();
      break;
    case "character_create":
      result = await db.from("characters").insert(normalizeCharacter(object(payload.data))).select("id").single();
      break;
    case "character_update":
      result = await db.from("characters").update(normalizeCharacter(object(payload.data))).eq("id", id(payload.id)).select("id").single();
      break;
    case "music_create":
      result = await db.from("music").insert({ ...normalizeMusic(object(payload.data)), owner_id: ownerUuid(ownerId) }).select("id").single();
      break;
    case "music_update":
      result = await db.from("music").update(normalizeMusic(object(payload.data))).eq("id", id(payload.id)).select("id").single();
      break;
    case "currently_playing_update": {
      const currentValue = payload.data === null ? null : only(object(payload.data), ["game_id", "title", "subtitle", "status", "note", "tags"]);
      const current = currentValue === null ? null : { ...currentValue, tags: textArray(currentValue.tags ?? [], 30) };
      result = await db.from("site_settings").upsert({ id: 1, currently_playing: current }, { onConflict: "id" }).select("id").single();
      break;
    }
    case "tier_board_create":
      result = await db.from("tier_boards").insert({ owner_id: ownerUuid(ownerId), title: requiredText(payload.title, 240), description: nullableText(payload.description, 2000), sort_order: optionalNumber(payload.sort_order) }).select("id,title,description,sort_order,created_at,updated_at").single();
      break;
    case "tier_board_update":
      result = await db.from("tier_boards").update({ title: requiredText(payload.title, 240), description: nullableText(payload.description, 2000) }).eq("id", id(payload.id)).select("id").single();
      break;
    case "tier_section_create":
      result = await db.from("tier_sections").insert({ board_id: id(payload.board_id), title: requiredText(payload.title, 240), description: nullableText(payload.description, 2000), sort_order: optionalNumber(payload.sort_order) }).select("id,board_id,title,description,sort_order,created_at,updated_at").single();
      break;
    case "tier_section_update":
      result = await db.from("tier_sections").update({ title: requiredText(payload.title, 240), description: nullableText(payload.description, 2000) }).eq("id", id(payload.id)).select("id").single();
      break;
    case "tier_sections_reorder": {
      if (!Array.isArray(payload.items) || payload.items.length > 100) throw new Error("INVALID_PAYLOAD");
      const updates = payload.items.map((entry) => only(object(entry), ["id", "sort_order"]));
      for (const entry of updates) {
        const update = await db.from("tier_sections").update({ sort_order: optionalNumber(entry.sort_order) }).eq("id", id(entry.id));
        if (update.error) throw update.error;
      }
      return { updated: updates.length };
    }
    case "tier_item_move": {
      const data = { section_id: id(payload.section_id), sort_order: optionalNumber(payload.sort_order) };
      result = payload.id
        ? await db.from("tier_items").update(data).eq("id", id(payload.id)).select("id,board_id,section_id,game_id,sort_order,created_at,updated_at").single()
        : await db.from("tier_items").insert({ ...data, board_id: id(payload.board_id), game_id: id(payload.game_id) }).select("id,board_id,section_id,game_id,sort_order,created_at,updated_at").single();
      break;
    }
    case "tier_items_reorder": {
      if (!Array.isArray(payload.items) || payload.items.length > 500) throw new Error("INVALID_PAYLOAD");
      const updates = payload.items.map((entry) => only(object(entry), ["id", "sort_order"]));
      for (const entry of updates) {
        const update = await db.from("tier_items").update({ sort_order: optionalNumber(entry.sort_order) }).eq("id", id(entry.id));
        if (update.error) throw update.error;
      }
      return { updated: updates.length };
    }
    case "upload_site_media": {
      const value = only(payload, ["path", "content_type", "base64"]);
      const path = requiredText(value.path, 300);
      const contentType = requiredText(value.content_type, 80);
      if (!/^(profile|collections|writings)\/[a-zA-Z0-9._/-]+$/.test(path) || path.includes("..")) throw new Error("INVALID_PAYLOAD");
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) throw new Error("INVALID_PAYLOAD");
      const encoded = requiredText(value.base64, 7_100_000);
      const binary = atob(encoded);
      if (binary.length > 5 * 1024 * 1024) throw new Error("INVALID_PAYLOAD");
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const upload = await db.storage.from("site-media").upload(path, bytes, { contentType, cacheControl: "3600", upsert: false });
      if (upload.error) throw upload.error;
      const publicUrl = db.storage.from("site-media").getPublicUrl(path).data.publicUrl;
      return { path, publicUrl };
    }
    default:
      throw new Error("UNKNOWN_ACTION");
  }

  if (result.error) throw result.error;
  return result.data;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin") ?? "";
  const headers = corsHeaders(origin);
  if (!headers) return jsonResponse(origin, { success: false, code: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return jsonResponse(origin, { success: false, code: "METHOD_NOT_ALLOWED" }, 405);

  const sessionSecret = Deno.env.get("EDITOR_SESSION_SECRET");
  const editorId = Deno.env.get("EDITOR_LOGIN_ID");
  if (!sessionSecret || !editorId) {
    console.error("Missing required editor-api session environment variables");
    return jsonResponse(origin, { success: false, code: "SERVER_CONFIG_ERROR" }, 500);
  }

  const verification = await verifyEditorToken(bearerToken(request), sessionSecret, editorId);
  if (!verification.claims) return jsonResponse(origin, { success: false, code: verification.code || "EDITOR_SESSION_INVALID" }, 401);

  let body: JsonObject;
  try {
    const value = await request.json();
    body = only(object(value), ["action", "payload"]);
  } catch {
    return jsonResponse(origin, { success: false, code: "INVALID_REQUEST" }, 400);
  }

  const action = String(body.action ?? "");
  if (!ACTIONS.has(action)) return jsonResponse(origin, { success: false, code: "UNKNOWN_ACTION" }, 403);
  if (action === "session_status") return jsonResponse(origin, { success: true, data: { role: "editor", identity: verification.claims.sub, expires_at: verification.claims.exp } });

  const url = Deno.env.get("SUPABASE_URL");
  const key = serverKey();
  if (!url || !key) {
    console.error("Missing Supabase server credential for editor-api");
    return jsonResponse(origin, { success: false, code: "SERVER_CONFIG_ERROR" }, 500);
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const data = await execute(action, { db, payload: object(body.payload ?? {}), ownerId: Deno.env.get("OWNER_USER_ID") });
    return jsonResponse(origin, { success: true, data });
  } catch (error) {
    const code = error instanceof Error && ["INVALID_PAYLOAD", "SERVER_CONFIG_ERROR", "UNKNOWN_ACTION"].includes(error.message)
      ? error.message
      : "WRITE_FAILED";
    console.error("EDITOR_API_FAILED", action, code);
    return jsonResponse(origin, { success: false, code }, code === "INVALID_PAYLOAD" ? 400 : 500);
  }
});
