import { createMcpy, KvCache, MemoryCache, type Mcpy } from "mcpy";
import type { Telemetry } from "mcpy/telemetry";
import type { Env, ServerEnv } from "./env.js";
import { buildProviders, type ProviderSetup } from "./providers.js";

// Per-isolate fallback cache when no KV namespace is bound (local dev).
const isolateCache = new MemoryCache(500);

/** One SDK instance per isolate, so circuit-breaker state persists across requests. */
const instances = new WeakMap<object, { mcpy: Mcpy; providers: ProviderSetup }>();

/** The SDK for this request: the isolate's shared engine with this request's telemetry. */
export function sdkFor(env: Env, config: ServerEnv, telemetry: Telemetry): { mcpy: Mcpy; providers: ProviderSetup } {
  let entry = instances.get(env);
  if (!entry) {
    const providers = buildProviders(config);
    const mcpy = createMcpy({
      pages: providers.pages,
      search: providers.search,
      papers: providers.papers,
      cache: env.CACHE ? new KvCache(env.CACHE) : isolateCache,
      limits: {
        attemptTimeoutMs: config.ATTEMPT_TIMEOUT_MS,
        deadlineMs: config.DEADLINE_MS,
        maxResponseBytes: config.MAX_RESPONSE_BYTES,
        pageTtlSeconds: config.PAGE_CACHE_TTL_SECONDS,
        searchTtlSeconds: config.SEARCH_CACHE_TTL_SECONDS,
        paperTtlSeconds: config.PAPER_CACHE_TTL_SECONDS,
      },
      retry: { retries: config.RETRIES },
      userAgent: { default: config.DEFAULT_USER_AGENT, custom: config.USER_AGENT_STRING },
    });
    entry = { mcpy, providers };
    instances.set(env, entry);
  }
  return { mcpy: entry.mcpy.withTelemetry(telemetry), providers: entry.providers };
}
