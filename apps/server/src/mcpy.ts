import { createMcpy, LayeredCache, type Mcpy } from "mcpy";
import type { Telemetry } from "mcpy/telemetry";
import type { Env, ServerEnv } from "./env.js";
import { buildProviders, type ProviderSetup } from "./providers.js";
import { workerLoaderScripts } from "./scripts.js";

/**
 * The isolate's memory, in front of KV when the CACHE namespace is bound (and
 * the only store in local dev without it). JS strings take two bytes a
 * character, so this keeps at most about 16 MB of a Worker's 128 MB; entries
 * over 512k characters live in KV only.
 */
const MEMORY = { maxEntries: 2_000, maxChars: 8_000_000, maxEntryChars: 512_000 };

/** One SDK instance per isolate, so circuit-breaker state persists across requests. */
const instances = new WeakMap<object, { mcpy: Mcpy; providers: ProviderSetup }>();

/** The SDK for this request: the isolate's shared engine with this request's telemetry. */
export function sdkFor(env: Env, config: ServerEnv, telemetry: Telemetry): { mcpy: Mcpy; providers: ProviderSetup } {
  let entry = instances.get(env);
  if (!entry) {
    const providers = buildProviders(config, { browser: env.BROWSER });
    const mcpy = createMcpy({
      pages: providers.pages,
      search: providers.search,
      papers: providers.papers,
      listings: providers.listings,
      crypto: providers.crypto,
      cache: new LayeredCache({ kv: env.CACHE, memory: MEMORY }),
      scripts: env.LOADER ? workerLoaderScripts(env.LOADER) : undefined,
      limits: {
        attemptTimeoutMs: config.ATTEMPT_TIMEOUT_MS,
        deadlineMs: config.DEADLINE_MS,
        maxResponseBytes: config.MAX_RESPONSE_BYTES,
        pageTtlSeconds: config.PAGE_CACHE_TTL_SECONDS,
        searchTtlSeconds: config.SEARCH_CACHE_TTL_SECONDS,
        paperTtlSeconds: config.PAPER_CACHE_TTL_SECONDS,
        thoroughGraceMs: config.THOROUGH_GRACE_MS,
      },
      retry: { retries: config.RETRIES },
      userAgent: { default: config.DEFAULT_USER_AGENT, custom: config.USER_AGENT_STRING },
    });
    entry = { mcpy, providers };
    instances.set(env, entry);
  }
  return { mcpy: entry.mcpy.withTelemetry(telemetry), providers: entry.providers };
}
