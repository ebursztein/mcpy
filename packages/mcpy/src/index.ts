/**
 * mcpy: web tools for agents behind one typed API.
 *
 *   import { createMcpy } from "mcpy";
 *   import { direct, firecrawl } from "mcpy/providers";
 *
 *   const mcpy = createMcpy({ pages: [direct(), firecrawl({ apiKey })] });
 *   const page = await mcpy.fetch({ url: "https://example.com" });
 */

export { Mcpy, type CallContext } from "./mcpy.js";
export { createMcpy, McpyConfigSchema, type McpyConfig, type McpyOptions } from "./create.js";
export { RestRoute, ToolName } from "./api/routes.js";
export { MAX_GREP_OUTPUT_CHARS, MAX_SNIPPET_CHARS } from "./api/operations.js";
export type { ScriptPage, ScriptRunner } from "./api/script.js";
export * from "./enums.js";
export * from "./schemas.js";
export { McpyError } from "./errors.js";
export { CacheInspectionSchema, type CacheInspection } from "./cache/inspect.js";
export { CacheTier, CacheTierSchema, LayeredCache, type KvLike, type LayeredCacheOptions, type MemoryOptions } from "./cache/layered.js";
export { EngineLimitsSchema, type Admit, type EngineLimits } from "./engine/engine.js";
export type { SpendLimit } from "./engine/meter.js";
export type { QuotaAlert, QuotaAlertSink } from "./engine/quota.js";
export { BreakerPolicySchema, type BreakerPolicy } from "./engine/breaker.js";
export { RetryPolicySchema, type RetryPolicy } from "./http/retry.js";
export { USER_AGENTS } from "./http/user-agents.js";
export type { Telemetry } from "./telemetry/telemetry.js";
export { EMPTY_SEARCH_TTL_SECONDS } from "./engine/engine.js";
export * from "./schemas-papers.js";
export * from "./schemas-crypto.js";
export * from "./schemas-stocks.js";
export * from "./schemas-batch.js";
export { FETCH_BATCH_CONCURRENCY, FETCH_BATCH_DEADLINE_MS, FETCH_BATCH_PER_SITE, runFetchBatch, type FetchBatchOptions } from "./api/batch.js";
export { MAX_ABSTRACT_CHARS } from "./api/papers.js";
export * from "./services/common.js";
export * from "./services/shopping/schema.js";
export * from "./services/shopping/marketplace.js";
