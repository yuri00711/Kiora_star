import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { bearerToken, verifyEditorToken } from "../_shared/editor-session.ts";

type JsonObject = Record<string, unknown>;

function serverKey(): string | null {
  if (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || null; } catch { return null; }
}

function uuid(value: unknown): string {
  const text = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error("INVALID_PAYLOAD");
  return text;
}

function reviewSchema() {
  const section = {
    type: "object", additionalProperties: false,
    properties: { summary: { type: "string" }, findings: { type: "array", items: { type: "object", additionalProperties: false, properties: { status: { type: "string", enum: ["covered","partial","missing","issue","good"] }, point: { type: "string" }, evidence: { type: "string" }, suggestion: { type: "string" } }, required: ["status","point","evidence","suggestion"] } },
    required: ["summary","findings"]
  };
  return {
    type: "object", additionalProperties: false,
    properties: {
      content_coverage: section, material_evidence: section, task_analysis: section,
      expression_review: section, structure_review: section,
      assessment: { type: "object", additionalProperties: false, properties: { level: { type: "string", enum: ["STRONG","GOOD","NEEDS REVIEW","INCOMPLETE"] }, main_issue: { type: "string" }, priorities: { type: "array", items: { type: "string" } }, character_control: { type: "string" } }, required: ["level","main_issue","priorities","character_control"] }
    },
    required: ["content_coverage","material_evidence","task_analysis","expression_review","structure_review","assessment"]
  };
}

function validateReview(value: unknown): asserts value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MODEL_OUTPUT_INVALID");
  const required = ["content_coverage","material_evidence","task_analysis","expression_review","structure_review","assessment"];
  if (required.some((key) => !(key in (value as JsonObject)))) throw new Error("MODEL_OUTPUT_INVALID");
  if (JSON.stringify(value).length > 150_000) throw new Error("MODEL_OUTPUT_INVALID");
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const headers = corsHeaders(origin);
  if (!headers) return jsonResponse(origin, { success: false, code: "ORIGIN_DENIED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return jsonResponse(origin, { success: false, code: "METHOD_NOT_ALLOWED" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = serverKey();
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!url || !key || !apiKey) {
    console.error("Missing required study-review environment variables");
    return jsonResponse(origin, { success: false, code: "SERVER_CONFIG_ERROR" }, 500);
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = bearerToken(request);
  let ownerId: string | null = null;
  const editorSecret = Deno.env.get("EDITOR_SESSION_SECRET");
  const editorId = Deno.env.get("EDITOR_LOGIN_ID");
  if (editorSecret && editorId) {
    const editor = await verifyEditorToken(token, editorSecret, editorId);
    if (editor.claims) ownerId = Deno.env.get("OWNER_USER_ID") || null;
  }
  if (!ownerId) {
    const user = await db.auth.getUser(token);
    ownerId = user.data.user?.id || null;
  }
  if (!ownerId) return jsonResponse(origin, { success: false, code: "AUTH_REQUIRED" }, 401);

  try {
    const body = await request.json();
    const answerId = uuid(body.answer_id);
    const { data: answer, error: answerError } = await db.from("study_shenlun_answers").select("*").eq("id", answerId).eq("owner_id", ownerId).single();
    if (answerError || !answer) throw new Error("NOT_FOUND");
    const [{ data: question }, { data: practice }, { data: reference }, { data: files }] = await Promise.all([
      db.from("study_shenlun_questions").select("*").eq("id", answer.question_id).eq("owner_id", ownerId).single(),
      db.from("study_practices").select("*").eq("id", answer.practice_id).eq("owner_id", ownerId).single(),
      db.from("study_shenlun_references").select("body").eq("question_id", answer.question_id).eq("owner_id", ownerId).maybeSingle(),
      db.from("study_files").select("extracted_text,file_kind").eq("practice_id", answer.practice_id).eq("owner_id", ownerId)
    ]);
    if (!question || !practice) throw new Error("NOT_FOUND");
    const material = (files || []).filter((file) => ["paper","material"].includes(file.file_kind)).map((file) => file.extracted_text || "").join("\n").slice(0, 100_000);
    const input = JSON.stringify({ material, question: { title: String(question.title || "").slice(0, 500), type: question.question_type, prompt: String(question.prompt || "").slice(0, 10_000), material_scope: String(question.material_scope || "").slice(0, 2_000), max_characters: question.max_characters }, reference_answer: String(reference?.body || "").slice(0, 50_000), user_answer: String(answer.body || "").slice(0, 30_000), essay_plan: { title: String(answer.title || "").slice(0, 500), thesis: String(answer.thesis || "").slice(0, 3_000), outline: Array.isArray(answer.outline) ? answer.outline.slice(0, 30) : [] } });
    const model = Deno.env.get("STUDY_REVIEW_MODEL") || "gpt-5-mini";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: "You are Kiora Review, a careful Chinese civil-service exam study reviewer. Compare only the supplied material, task, reference, and answer. Explain evidence for every major judgment. Use cautious wording for subjective structure judgments. Do not claim to be an official examiner. For essay questions, assess response to the prompt, thesis, supporting sub-arguments, evidence, material use, paragraph logic, opening, ending, expression, and length instead of forcing a small-question reference-point score. Return only the requested JSON.", input, text: { format: { type: "json_schema", name: "study_review", strict: true, schema: reviewSchema() } } })
    });
    if (!response.ok) { console.error("STUDY_REVIEW_PROVIDER_FAILED", response.status); throw new Error("REVIEW_UNAVAILABLE"); }
    const generated = await response.json();
    const text = generated.output_text || generated.output?.flatMap((item: JsonObject) => Array.isArray(item.content) ? item.content : []).find((item: JsonObject) => item.type === "output_text")?.text;
    const review = JSON.parse(String(text || ""));
    validateReview(review);
    const record = { owner_id: ownerId, practice_id: answer.practice_id, question_id: answer.question_id, answer_id: answer.id, content_coverage: review.content_coverage, material_evidence: review.material_evidence, task_analysis: review.task_analysis, expression_review: review.expression_review, structure_review: review.structure_review, assessment: review.assessment, model, model_version: generated.model || model };
    const saved = await db.from("study_reviews").insert(record).select("*").single();
    if (saved.error) throw saved.error;
    return jsonResponse(origin, { success: true, data: saved.data });
  } catch (error) {
    const code = error instanceof Error && ["INVALID_PAYLOAD","NOT_FOUND","MODEL_OUTPUT_INVALID","REVIEW_UNAVAILABLE"].includes(error.message) ? error.message : "REVIEW_FAILED";
    console.error("STUDY_REVIEW_FAILED", code);
    return jsonResponse(origin, { success: false, code }, code === "NOT_FOUND" ? 404 : 500);
  }
});
