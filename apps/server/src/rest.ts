/**
 * REST front door, built only on the public SDK.
 *
 *   GET|POST /v1/fetch   /v1/grep   /v1/search   /v1/papers    (same fields as the SDK)
 *   POST     /v1/fetch/batch {requests: [fetch input, ...]}  (each request counts against the rate limit)
 *   e.g. GET /v1/search?query=rust&type=news&recency=week&country=us&sites=github.com,lwn.net
 *   GET|POST /v1/usage  /v1/usage/log              (the caller's own usage; admins may pass client)
 *   GET      /v1/admin/dashboard                   (admin clients only: the data dash.ly.tl shows)
 *   GET      /v1/admin/providers                   (admin clients only)
 *   GET      /v1/admin/spending                    (admin clients only: today's spend per client)
 *   GET      /v1/admin/cache?cache_key=<key>       (admin clients only: one cache entry, key as logs show it)
 *
 * POST takes a JSON body; GET takes the same fields as query parameters so
 * URL-only agents can call it. Responses are JSON; errors use ErrorBody.
 */

import { ErrorCode, FETCH_BATCH_MAX_REQUESTS, McpyError, RestRoute, type CacheInspection, type McpyApi } from "mcpy";
import { ClientRole, type Client } from "./clients.js";
import { secondsUntilReset } from "./budget.js";
import { budgetHeaders, resultHeaders, type CallBudget } from "./call-headers.js";
import type { ProviderSetup } from "./providers.js";
import { batchSize, rateLimited } from "./rate-limit.js";
import { dashboardData, UsageRoute, usageLogFor, usageSummary, type UsageDeps } from "./usage/api.js";

export const AdminRoute = { Providers: "/v1/admin/providers", Spending: "/v1/admin/spending", Cache: "/v1/admin/cache" } as const;

/** What the admin routes report on. */
export interface AdminView {
  providers: ProviderSetup;
  /** Undefined when no BUDGET binding is configured. */
  spending?: () => Promise<unknown>;
  /** One cache entry by its full key. */
  cache?: (key: string) => Promise<CacheInspection>;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });

export const errorResponse = (err: McpyError, headers: Record<string, string> = {}) => json(err.toJSON(), err.httpStatus, headers);

const NUMERIC = new Set(["limit", "days", "years", "offset", "max_chars", "max_age", "context", "max_matches", "max_results", "page", "year_from", "year_to"]);
const BOOLEAN = new Set(["literal", "open_access", "paid_only", "errors_only", "cache_hits_only"]);
const LIST = new Set(["sites", "exclude_sites", "symbols"]);

/**
 * Query strings are untyped: coerce the known numeric, boolean and list
 * fields (lists are comma-separated: sites=a.com,b.org).
 */
function fromQuery(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of params) {
    if (k === "key") continue; // credentials, not input
    if (NUMERIC.has(k) && /^\d+$/.test(v)) out[k] = Number(v);
    else if (BOOLEAN.has(k) && (v === "true" || v === "false")) out[k] = v === "true";
    else if (LIST.has(k)) out[k] = v.split(",").map((s) => s.trim()).filter(Boolean);
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
  [RestRoute.FetchBatch]: (api, input) => api.fetchBatch(input as never),
  [RestRoute.Grep]: (api, input) => api.grep(input as never),
  [RestRoute.Search]: (api, input) => api.search(input as never),
  [RestRoute.Papers]: (api, input) => api.papers(input as never),
  [RestRoute.Shopping]: (api, input) => api.shopping(input as never),
  [RestRoute.ShoppingItem]: (api, input) => api.shoppingItem(input as never),
  [RestRoute.CryptoMarket]: (api, input) => api.cryptoMarket(input as never),
  [RestRoute.CryptoCoin]: (api, input) => api.cryptoCoin(input as never),
  [RestRoute.StockQuote]: (api, input) => api.stockQuote(input as never),
  [RestRoute.StockHistory]: (api, input) => api.stockHistory(input as never),
  [RestRoute.StockFundamentals]: (api, input) => api.stockFundamentals(input as never),
};

/** What a REST call is served with besides the SDK. */
export interface RestOptions {
  admin: AdminView;
  /** Undefined when no USAGE binding is configured. */
  usage?: UsageDeps;
  /** The client's cap, for the budget headers; undefined without one. */
  budget?: CallBudget;
  /**
   * Counts more requests against the client's rate limit (the call itself was
   * counted on arrival); false when that is over it.
   */
  chargeCalls?: (calls: number) => Promise<boolean>;
}

export async function handleRest(request: Request, url: URL, api: McpyApi, client: Client, options: RestOptions): Promise<Response> {
  const { admin, usage, budget } = options;
  const isAdminRoute = Object.values(AdminRoute).includes(url.pathname as (typeof AdminRoute)[keyof typeof AdminRoute]);
  if (isAdminRoute && client.role !== ClientRole.Admin) return errorResponse(new McpyError(ErrorCode.Forbidden, "admin only"));
  if (url.pathname === AdminRoute.Spending) {
    if (!admin.spending) return errorResponse(new McpyError(ErrorCode.NotFound, "spending caps are not configured (no BUDGET binding)"));
    return json(await admin.spending());
  }
  if (url.pathname === AdminRoute.Cache) {
    // Not `key`: that parameter carries the caller's API key.
    const key = url.searchParams.get("cache_key");
    if (!admin.cache) return errorResponse(new McpyError(ErrorCode.NotFound, "cache inspection is not available"));
    if (!key) return errorResponse(new McpyError(ErrorCode.InvalidInput, "cache_key is required: the full cache key, as mcpy.cache.key in a log shows it"));
    return json(await admin.cache(key));
  }
  if (url.pathname === AdminRoute.Providers) {
    const { providers } = admin;
    return json({
      pages: providers.pages.map((p) => p.id),
      search: providers.search.map((p) => p.id),
      papers: providers.papers.map((p) => p.id),
      listings: providers.listings.map((p) => p.id),
      crypto: providers.crypto.map((p) => p.id),
      stocks: providers.stocks.map((p) => p.id),
      skipped: providers.skipped,
    });
  }

  if (url.pathname === UsageRoute.Summary || url.pathname === UsageRoute.Log || url.pathname === UsageRoute.Dashboard) {
    if (!usage) return errorResponse(new McpyError(ErrorCode.NotFound, "usage is not recorded (no USAGE binding)"));
    const read = url.pathname === UsageRoute.Summary ? usageSummary : url.pathname === UsageRoute.Log ? usageLogFor : dashboardData;
    try {
      return json(await read(client, await readInput(request, url), usage));
    } catch (err) {
      return errorResponse(err instanceof McpyError ? err : new McpyError(ErrorCode.Internal, "internal error"));
    }
  }

  const operation = OPERATIONS[url.pathname as RestRoute];
  if (!operation) return errorResponse(new McpyError(ErrorCode.NotFound, `unknown route ${url.pathname}`));
  if (request.method !== "GET" && request.method !== "POST") {
    const err = new McpyError(ErrorCode.InvalidInput, "use GET or POST");
    return json(err.toJSON(), 405, { Allow: "GET, POST" });
  }

  // Read today's spend while the call runs: the budget headers never wait on it alone.
  const spent = budget?.spentToday().catch(() => undefined);
  const budgetOf = async (costUsd: number) => {
    const before = await spent;
    return budget && before !== undefined ? budgetHeaders(budget.capUsd, before, costUsd) : {};
  };
  try {
    const input = await readInput(request, url);
    // A batch of N counts N against the rate limit; one too large is refused by the SDK, uncounted.
    const size = url.pathname === RestRoute.FetchBatch ? batchSize(input) : 0;
    if (size > 1 && size <= FETCH_BATCH_MAX_REQUESTS && options.chargeCalls && !(await options.chargeCalls(size - 1))) {
      const refusal = rateLimited();
      return errorResponse(refusal.error, refusal.headers);
    }
    const result = await operation(api, input);
    const { headers, costUsd } = resultHeaders(result);
    return json(result, 200, { ...headers, ...(await budgetOf(costUsd)) });
  } catch (err) {
    const error = err instanceof McpyError ? err : new McpyError(ErrorCode.Internal, "internal error");
    // Caps reset at midnight UTC: tell callers when retrying is worth it.
    const headers: Record<string, string> = error.code === ErrorCode.BudgetExceeded ? { "Retry-After": String(secondsUntilReset(new Date())) } : {};
    return errorResponse(error, { ...headers, ...(await budgetOf(0)) });
  }
}
