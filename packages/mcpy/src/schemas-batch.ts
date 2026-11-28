/**
 * fetch_batch: many fetches in one call. Each request is a fetch input of its
 * own (its max_age, free_only, method, ...) and is answered on its own, in
 * order: a result, or the error that request alone failed with, with the
 * request's id when it gave one.
 */

import { z } from "zod";
import { ErrorBodySchema, FetchInputSchema, FetchResultSchema } from "./schemas.js";

/**
 * Most requests one batch takes (owner, 2026-11-27). Each is a full fetch on
 * the server (cache reads and writes, the site itself) and counts against the
 * per-key rate limit as its own call.
 */
export const FETCH_BATCH_MAX_REQUESTS = 64;

/** A fetch input, with an optional id the answer echoes. */
export const FetchBatchRequestSchema = FetchInputSchema.extend({
  id: z.string().min(1).max(100).optional().describe("Echoed on this request's answer, to match it without counting positions"),
});

export const FetchBatchInputSchema = z.object({
  requests: z
    .array(FetchBatchRequestSchema)
    .min(1)
    .max(FETCH_BATCH_MAX_REQUESTS)
    .describe(`Up to ${FETCH_BATCH_MAX_REQUESTS} fetch requests, each with the fields of fetch; answered in the same order`),
});

/** One request's answer: its fetch result, or the error it failed with. */
const echoedId = { id: z.string().optional() };
export const FetchBatchEntrySchema = z.union([z.object({ ...echoedId, result: FetchResultSchema }), ErrorBodySchema.extend(echoedId)]);

export const FetchBatchResultSchema = z.object({
  results: z.array(FetchBatchEntrySchema),
  meta: z.object({
    latency_ms: z.number(),
    /** What the answered requests cost. A failed one's cost counts against the cap all the same (and is in the usage log). */
    cost_usd: z.number(),
    /** Requests run through fetch (cache hits included); identical reads count once, and one the deadline left unsent not at all. */
    fetched: z.number().int(),
    /** Requests answered by an identical read in the same batch. */
    deduplicated: z.number().int(),
    /** Requests answered from the cache. */
    cache_hits: z.number().int(),
    /** Requests that failed (their entry is an error). */
    failed: z.number().int(),
  }),
});

export type FetchBatchInput = z.input<typeof FetchBatchInputSchema>;
export type FetchBatchRequest = z.infer<typeof FetchBatchRequestSchema>;
export type FetchBatchEntry = z.infer<typeof FetchBatchEntrySchema>;
export type FetchBatchResult = z.infer<typeof FetchBatchResultSchema>;
