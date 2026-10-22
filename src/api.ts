/**
 * REST front door for agents and services that do not speak MCP.
 *
 *   GET|POST /v1/fetch      { url, format?, start_index?, max_length?, provider?, fresh? }
 *   GET|POST /v1/grep       { url, pattern, context_lines?, max_matches?, format?, provider?, fresh? }
 *   GET|POST /v1/search     { query, limit?, provider?, fresh? }
 *   GET      /v1/providers
 *
 * POST takes a JSON body; GET takes the same fields as query parameters so
 * URL-only agents can call it too. Responses are JSON.
 */

import { z } from "zod";
import type { WebService } from "./core/service";
import { InvalidTargetError } from "./lib/http";
import { fetchInput, grepInput, runFetch, runGrep, runSearch, searchInput } from "./tools/operations";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Query strings are untyped; coerce the fields the schemas expect as numbers/booleans. */
function fromQuery(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of params) {
    if (k === "key") continue; // auth only
    if (v === "true" || v === "false") out[k] = v === "true";
    else if (/^\d+$/.test(v) && k !== "query" && k !== "pattern") out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}

async function readInput(request: Request, url: URL): Promise<Record<string, unknown>> {
  if (request.method === "GET") return fromQuery(url.searchParams);
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new BadRequest("body must be a JSON object");
}

class BadRequest extends Error {}

const ROUTES = {
  "/v1/fetch": { schema: fetchInput, run: runFetch, tool: "api_fetch" },
  "/v1/grep": { schema: grepInput, run: runGrep, tool: "api_grep" },
  "/v1/search": { schema: searchInput, run: runSearch, tool: "api_search" },
} as const;

export async function handleApi(request: Request, url: URL, web: WebService): Promise<Response> {
  if (url.pathname === "/v1/providers") {
    return request.method === "GET" ? json(web.providers()) : json({ error: "method not allowed" }, 405);
  }

  const route = ROUTES[url.pathname as keyof typeof ROUTES];
  if (!route) return json({ error: "not found" }, 404);
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "method not allowed" }, 405);

  let input: unknown;
  try {
    const raw = await readInput(request, url);
    input = (route.schema as z.ZodType).parse(raw);
  } catch (err) {
    const detail = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) : [errMsg(err)];
    return json({ error: "invalid request", detail }, 400);
  }

  try {
    // Each route pairs a schema with its own operation; the cast only bridges the union.
    const result = await (route.run as (w: WebService, t: string, i: unknown) => Promise<unknown>)(web, route.tool, input);
    return json(result);
  } catch (err) {
    if (err instanceof InvalidTargetError) return json({ error: errMsg(err) }, 400);
    // Provider failures: every configured upstream failed or refused.
    return json({ error: errMsg(err) }, 502);
  }
}
