const ALLOWED_ORIGINS = new Set([
  "https://kiora.space",
  "https://www.kiora.space",
]);

export function corsHeaders(origin: string): Record<string, string> | null {
  if (!ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function jsonResponse(
  origin: string,
  body: Record<string, unknown>,
  status = 200,
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
