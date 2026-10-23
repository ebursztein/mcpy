/**
 * mcpy: web tools for agents behind one typed API.
 *
 *   import { createMcpy } from "mcpy";
 *   import { direct, firecrawl } from "mcpy/providers";
 *
 *   const mcpy = createMcpy({ pages: [direct(), firecrawl({ apiKey })] });
 *   const page = await mcpy.fetch({ url: "https://example.com" });
 */

export { createMcpy, Mcpy, McpyConfigSchema, type CallContext, type McpyConfig, type McpyOptions } from "./mcpy.js";
export { RestRoute, ToolName } from "./api/routes.js";
export { MAX_GREP_OUTPUT_CHARS, MAX_SNIPPET_CHARS } from "./api/operations.js";
export * from "./enums.js";
export * from "./schemas.js";
export { McpyError } from "./errors.js";
export { KvCache, MemoryCache, NoCache, type Cache, type KvLike } from "./engine/cache.js";
export { EngineLimitsSchema, type EngineLimits } from "./engine/engine.js";
export { BreakerPolicySchema, type BreakerPolicy } from "./engine/breaker.js";
export { RetryPolicySchema, type RetryPolicy } from "./http/retry.js";
export { USER_AGENTS } from "./http/user-agents.js";
export type { Telemetry } from "./telemetry/telemetry.js";
export { EMPTY_SEARCH_TTL_SECONDS } from "./engine/engine.js";
export * from "./schemas-papers.js";
export { MAX_ABSTRACT_CHARS } from "./api/papers.js";
