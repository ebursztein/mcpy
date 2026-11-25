/**
 * The call log: one row per mcpy call (one per store for shopping_search),
 * with what was asked (tool, query, args), where it went (domain, store),
 * how it went (status, cache, attempts, time taken) and what it cost. Costs
 * are mcpy's estimates, the numbers the daily cap counts. Headers, request
 * bodies and fetch scripts are never logged. The backend that served a call
 * is an opaque id; only admins see its name.
 */

import { CacheStatusSchema, enumOf, OperationSchema, SearchTypeSchema, TransportSchema } from "mcpy";
import { z } from "zod";

/** Days of rows kept; older ones are deleted as new ones arrive. */
export const RETENTION_DAYS = 30;
export const MAX_LOG_LIMIT = 500;
export const MAX_QUERY_CHARS = 2_000;
export const MAX_ARGS_CHARS = 4_000;
/** Input fields never logged: they can carry credentials or large private payloads. */
export const UNLOGGED_ARGS: readonly string[] = ["headers", "body", "script", "cursor", "key"];

const usd = z.number().min(0);
const count = z.number().int().min(0);

/** ok, error (the call failed), or a store's own status on shopping_search. */
const callStatus = enumOf({ Ok: "ok", Error: "error", Empty: "empty", Unsupported: "unsupported", Failed: "failed", OverBudget: "over_budget" } as const);
export const CallStatus = callStatus.values;
export const CallStatusSchema = callStatus.schema;
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const CallRowSchema = z.object({
  time: z.string().datetime().describe("When the call started (UTC)"),
  client: z.string().min(1).max(64),
  call_id: z.string().min(1).max(64).describe("Rows of one call (a shopping_search has one per store) share it"),
  tool: OperationSchema,
  query: z.string().max(MAX_QUERY_CHARS).optional().describe("The URL (fetch, grep, shopping_item) or the search text"),
  domain: z.string().max(253).optional(),
  store: z.string().max(64).optional().describe("shopping_search: the store key; crypto_coin: the coin and kind of day, e.g. \"BTC complete\""),
  search_type: SearchTypeSchema.optional(),
  args: z.record(z.string(), z.unknown()).describe("The other inputs as given (no headers, body, script or cursor)"),
  transport: TransportSchema.optional(),
  backend_id: count.optional().describe("Which backend served it, as an opaque number (the same number is the same backend)"),
  backend: z.string().max(64).optional().describe("Admin only: the backend's name"),
  status: CallStatusSchema,
  error: z.string().max(100).optional().describe("Error code, or the store's failure reason"),
  cache: CacheStatusSchema.optional(),
  cache_hit: z.boolean(),
  attempts: count.optional().describe("Upstream requests (0 when served from cache)"),
  duration_ms: count,
  cost_usd: usd,
  results: count.optional(),
});
export type CallRow = z.infer<typeof CallRowSchema>;

const GroupSchema = z.object({
  key: z.string(),
  calls: count,
  paid_calls: count,
  cache_hits: count,
  errors: count,
  cost_usd: usd,
  avg_ms: count,
});
export type Group = z.infer<typeof GroupSchema>;

export const UsageInputSchema = z.object({
  days: z.number().int().min(1).max(RETENTION_DAYS).default(1).describe("Today and the days before it (UTC)"),
  client: z.string().min(1).max(64).optional().describe("Admin only: one client, or * for every client"),
});
export type UsageInput = z.infer<typeof UsageInputSchema>;

export const UsageResultSchema = z.object({
  client: z.string(),
  since: z.string().describe("Start of the period (UTC midnight)"),
  today: z
    .object({
      spent_usd: usd.describe("Counted against today's cap"),
      cap_usd: usd.optional().describe("Absent: no cap"),
      remaining_usd: usd.optional(),
      resets_in_seconds: count,
    })
    .optional()
    .describe("One client only"),
  totals: GroupSchema.extend({ cache_hit_rate: z.number().min(0).max(1), max_ms: count }),
  by_day: z.array(GroupSchema).describe("key: the UTC day, newest first"),
  by_tool: z.array(GroupSchema),
  by_domain: z.array(GroupSchema).describe("Most expensive first, then busiest; top 50"),
  by_store: z.array(GroupSchema),
  by_backend: z.array(GroupSchema).describe("key: the backend id (its name for admins)"),
  by_search_type: z.array(GroupSchema),
  by_client: z.array(GroupSchema).optional().describe("Admin view of every client"),
});
export type UsageResult = z.infer<typeof UsageResultSchema>;

export const UsageLogInputSchema = z.object({
  limit: z.number().int().min(1).max(MAX_LOG_LIMIT).default(50),
  days: z.number().int().min(1).max(RETENTION_DAYS).default(RETENTION_DAYS),
  tool: OperationSchema.optional(),
  domain: z.string().trim().min(1).max(253).optional().describe("www. is ignored"),
  store: z.string().trim().min(1).max(64).optional(),
  search_type: SearchTypeSchema.optional(),
  query: z.string().trim().min(1).max(200).optional().describe("Rows whose query contains this text"),
  paid_only: z.boolean().default(false),
  errors_only: z.boolean().default(false),
  cache_hits_only: z.boolean().default(false),
  client: z.string().min(1).max(64).optional().describe("Admin only: one client, or * for every client"),
});
export type UsageLogInput = z.infer<typeof UsageLogInputSchema>;

export const UsageLogResultSchema = z.object({
  client: z.string(),
  calls: z.array(CallRowSchema).describe("Newest first"),
  more: z.boolean().describe("Older matching rows exist"),
});
export type UsageLogResult = z.infer<typeof UsageLogResultSchema>;
