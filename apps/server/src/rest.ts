/**
 * REST front door, built only on the public SDK.
 *
 *   GET|POST /v1/fetch   /v1/grep   /v1/search    (same fields as the SDK)
 *   GET      /v1/admin/providers                   (admin clients only)
 *
 * POST takes a JSON body; GET takes the same fields as query parameters so
 * URL-only agents can call it. Responses are JSON; errors use ErrorBody.
 */

import { ErrorCode, McpyError, RestRoute, type McpyApi } from "mcpy";
import { ClientRole, type Client } from "./clients.js";
import type { ProviderSetup } from "./providers.js";

export const AdminRoute = { Providers: "/v1/admin/providers" } as const;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });

export const errorResponse = (err: McpyError, headers: Record<string, string> = {}) => json(err.toJSON(), err.httpStatus, headers);

const NUMERIC = new Set(["start_index", "max_length", "context_lines", "max_matches", "limit"]);
const BOOLEAN = new Set(["fresh"]);

/** Query strings are untyped: coerce the known numeric/boolean fields. */
function fromQuery(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of params) {
    if (k === "key") continue; // credentials, not input
    if (NUMERIC.has(k) && /^\d+$/.test(v)) out[k] = Number(v);
    else if (BOOLEAN.has(k) && (v === "true" || v === "false")) out[k] = v === "true";
    else out[k] = v;
  }
  return out;
}

async function readInput(request: Request, url: URL): Promise<unknown> {
  if (request.method === "GET") return fromQuery(url.searchParams);
  const body = await request.json().catch(() => undefined);
  if (body && typeof body === "object" && !Array.isArray(body)) return body;
  throw new McpyError(ErrorCode.InvalidInput, "body must be a JSON object");
}

const OPERATIONS: Record<RestRoute, (api: McpyApi, input: unknown) => Promise<unknown>> = {
  // The SDK validates input with zod; `never` hands it the raw value.
  [RestRoute.Fetch]: (api, input) => api.fetch(input as never),
  [RestRoute.Grep]: (api, input) => api.grep(input as never),
  [RestRoute.Search]: (api, input) => api.search(input as never),
};

export async function handleRest(request: Request, url: URL, api: McpyApi, client: Client, providers: ProviderSetup): Promise<Response> {
  if (url.pathname === AdminRoute.Providers) {
    if (client.role !== ClientRole.Admin) return errorResponse(new McpyError(ErrorCode.Forbidden, "admin only"));
    return json({
      pages: providers.pages.map((p) => p.id),
      search: providers.search.map((p) => p.id),
      skipped: providers.skipped,
    });
  }

  const operation = OPERATIONS[url.pathname as RestRoute];
  if (!operation) return errorResponse(new McpyError(ErrorCode.NotFound, `unknown route ${url.pathname}`));
  if (request.method !== "GET" && request.method !== "POST") {
    const err = new McpyError(ErrorCode.InvalidInput, "use GET or POST");
    return json(err.toJSON(), 405, { Allow: "GET, POST" });
  }

  try {
    return json(await operation(api, await readInput(request, url)));
  } catch (err) {
    return errorResponse(err instanceof McpyError ? err : new McpyError(ErrorCode.Internal, "internal error"));
  }
}
