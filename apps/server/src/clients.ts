/**
 * Named API clients. MCPY_CLIENTS holds `name:key[:role]` entries, comma
 * separated. Each key maps to a client name that shows up in every log
 * line, span and metric, and gets its own rate-limit bucket.
 */

import { ErrorCode, McpyError } from "mcpy";
import { z } from "zod";

export const ClientRole = { User: "user", Admin: "admin" } as const;
export const ClientRoleSchema = z.enum([ClientRole.User, ClientRole.Admin]);
export type ClientRole = z.infer<typeof ClientRoleSchema>;

export const ClientSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, "client names are lowercase letters, digits, _ and -"),
  key: z.string().min(24, "keys must be at least 24 characters"),
  role: ClientRoleSchema.default(ClientRole.User),
});
export type Client = z.infer<typeof ClientSchema>;

/** The identity used when ALLOW_ANONYMOUS is on (local development). */
export const ANONYMOUS: Client = { name: "anonymous", key: "", role: ClientRole.Admin };

export function parseClients(raw: string | undefined): Client[] {
  const entries = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const clients = entries.map((entry, index) => {
    const [name, key, role] = entry.split(":");
    const parsed = ClientSchema.safeParse({ name, key, role: role || undefined });
    if (!parsed.success) {
      throw new McpyError(ErrorCode.Internal, `MCPY_CLIENTS entry ${index + 1} is invalid`, parsed.error.issues.map((i) => i.message));
    }
    return parsed.data;
  });
  const names = new Set(clients.map((c) => c.name));
  if (names.size !== clients.length) throw new McpyError(ErrorCode.Internal, "MCPY_CLIENTS has duplicate client names");
  return clients;
}

/**
 * Where a client may put its key, in order of preference:
 *   Authorization: Bearer <key>   (MCP clients, API callers)
 *   X-API-Key: <key>              (simple HTTP clients)
 *   ?key=<key>                    (web agents that can only be given a URL)
 */
export function extractKey(request: Request, url: URL): string | undefined {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1]?.trim();
  return bearer || request.headers.get("X-API-Key")?.trim() || url.searchParams.get("key")?.trim() || undefined;
}

/** Copy of the request without the URL key, so it is not passed downstream. */
export function stripUrlKey(request: Request, url: URL): Request {
  if (!url.searchParams.has("key")) return request;
  const clean = new URL(url);
  clean.searchParams.delete("key");
  return new Request(clean, request);
}

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant-time: hash both sides so lengths match, then compare every byte. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** The client owning `key`, checking every entry so timing does not leak a match position. */
export async function findClient(clients: Client[], key: string | undefined): Promise<Client | undefined> {
  if (!key) return undefined;
  let found: Client | undefined;
  for (const client of clients) {
    if ((await safeEqual(key, client.key)) && !found) found = client;
  }
  return found;
}
