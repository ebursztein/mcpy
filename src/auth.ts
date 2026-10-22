import type { Config } from "./config";

const encoder = new TextEncoder();

async function digest(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(s));
}

/**
 * Constant-time comparison. Hashing both sides first makes the lengths equal,
 * so the XOR loop always does the same work. Portable (Workers and Node).
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([digest(a), digest(b)]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Where a client may put its key, in order of preference:
 *   Authorization: Bearer <key>   (MCP clients, API callers)
 *   X-API-Key: <key>              (simple HTTP clients)
 *   ?key=<key>                    (web agents that can only be given a URL)
 * URL keys end up in logs and browser history: issue those clients their
 * own token so it can be rotated independently.
 */
export function extractKey(request: Request, url: URL): string | undefined {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1]?.trim();
  return bearer || request.headers.get("X-API-Key")?.trim() || url.searchParams.get("key")?.trim() || undefined;
}

/** Copy of the request with the URL key removed, so it is not passed downstream. */
export function stripUrlKey(request: Request, url: URL): Request {
  if (!url.searchParams.has("key")) return request;
  const clean = new URL(url);
  clean.searchParams.delete("key");
  return new Request(clean, request);
}

export type AuthResult = { ok: true } | { ok: false; response: Response };

/**
 * Fails closed: with no tokens configured every request is rejected unless
 * ALLOW_ANONYMOUS=true (meant for local development only).
 */
export async function authorize(request: Request, url: URL, config: Config): Promise<AuthResult> {
  if (config.allowAnonymous) return { ok: true };

  const key = extractKey(request, url);
  if (key) {
    for (const allowed of config.authTokens) {
      if (await safeEqual(key, allowed)) return { ok: true };
    }
  }
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="toolshed"' },
    }),
  };
}
