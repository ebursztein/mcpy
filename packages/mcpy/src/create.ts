/** Building the SDK: its settings (validated with zod) and the sources it runs on. */

import { z } from "zod";
import type { ScriptRunner } from "./api/script.js";
import { LayeredCache } from "./cache/layered.js";
import { BreakerPolicySchema, CircuitBreaker } from "./engine/breaker.js";
import { Engine, EngineLimitsSchema } from "./engine/engine.js";
import { UserAgentProfile, UserAgentProfileSchema } from "./enums.js";
import { HttpClient } from "./http/client.js";
import { RetryPolicySchema } from "./http/retry.js";
import { Mcpy } from "./mcpy.js";
import type { CryptoProvider } from "./providers/crypto-types.js";
import type { ListingProvider } from "./providers/listing-types.js";
import type { PaperProvider } from "./providers/paper-types.js";
import type { StockProvider } from "./providers/stock-types.js";
import type { PageProvider, SearchProvider } from "./providers/types.js";
import { Telemetry } from "./telemetry/telemetry.js";

/** Tunables, validated with zod; every field has a default. */
export const McpyConfigSchema = z.object({
  limits: EngineLimitsSchema.default(EngineLimitsSchema.parse({})),
  retry: RetryPolicySchema.default(RetryPolicySchema.parse({})),
  breaker: BreakerPolicySchema.default(BreakerPolicySchema.parse({})),
  userAgent: z
    .object({
      default: UserAgentProfileSchema.default(UserAgentProfile.Default),
      /** Replaces the `mcpy` profile string, e.g. to add your contact URL. */
      custom: z.string().min(1).max(512).optional(),
    })
    .default({ default: UserAgentProfile.Default }),
});
export type McpyConfig = z.input<typeof McpyConfigSchema>;

export interface McpyOptions extends McpyConfig {
  /** Page sources, tried in order. */
  pages?: PageProvider[];
  /** Search sources, tried in order. */
  search?: SearchProvider[];
  /** Paper indexes, tried in order. */
  papers?: PaperProvider[];
  /** Marketplace listing APIs, the last resort for shopping sites whose pages no page source could fetch. */
  listings?: ListingProvider[];
  /** Crypto market and network sources, merged field by field in this order. */
  crypto?: CryptoProvider[];
  /** Stock sources, asked in this order: a later one only for what earlier ones did not answer. */
  stocks?: StockProvider[];
  /** Defaults to a memory-only LayeredCache; give it `kv` to share entries across isolates. */
  cache?: LayeredCache;
  /** Defaults to no telemetry. */
  telemetry?: Telemetry;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Runs fetch scripts; without one, fetch rejects `script`. */
  scripts?: ScriptRunner;
}

/** Build the SDK from providers and (validated) settings. */
export function createMcpy(options: McpyOptions = {}): Mcpy {
  const config = McpyConfigSchema.parse({ limits: options.limits, retry: options.retry, breaker: options.breaker, userAgent: options.userAgent });
  const engine = new Engine({
    pageProviders: options.pages ?? [],
    searchProviders: options.search ?? [],
    paperProviders: options.papers ?? [],
    listingProviders: options.listings ?? [],
    cryptoProviders: options.crypto ?? [],
    stockProviders: options.stocks ?? [],
    cache: options.cache ?? new LayeredCache(),
    http: new HttpClient({ fetch: options.fetch ?? globalThis.fetch.bind(globalThis), retry: config.retry }),
    breaker: new CircuitBreaker(config.breaker),
    limits: config.limits,
    userAgents: { defaultProfile: config.userAgent.default, customString: config.userAgent.custom },
  });
  return new Mcpy(engine, options.telemetry ?? Telemetry.noop(), config.userAgent.default, options.scripts);
}
