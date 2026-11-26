/**
 * Worker env -> typed server config, validated with zod. Every setting is a
 * var or secret, so anyone can run their own deployment without code edits.
 */

import { LogLevel, LogLevelSchema, UserAgentProfile, UserAgentProfileSchema, type KvLike } from "mcpy";
import { ProviderId, ProviderIdSchema } from "mcpy/providers";
import type { AnalyticsDatasetLike } from "mcpy/telemetry";
import { z } from "zod";
import type { BrowserBindingLike } from "./browser.js";
import type { BudgetNamespaceLike } from "./budget.js";
import type { WorkerLoaderLike } from "./scripts.js";

export interface RateLimiterLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Bindings and raw string vars, exactly as Workers provides them. */
export interface Env {
  CACHE?: KvLike;
  TELEMETRY?: AnalyticsDatasetLike;
  RATE_LIMITER?: RateLimiterLike;
  /** Counts failed authentications per client IP, to slow down key guessing. */
  AUTH_LIMITER?: RateLimiterLike;
  /** One Durable Object per client holding today's spend (see budget.ts). */
  BUDGET?: BudgetNamespaceLike;
  /** One Durable Object holding every client's call log (see usage/log.ts). */
  USAGE?: BudgetNamespaceLike;
  /** Runs fetch scripts; without it, fetch rejects `script`. */
  LOADER?: WorkerLoaderLike;
  /** Browser Rendering: enables the cloudflare_browser page provider with no API token. */
  BROWSER?: BrowserBindingLike;
  [key: string]: unknown;
}

/** Comma-separated list; `fallback` applies when the var is unset or empty. */
const csv = <T extends z.ZodType<unknown, string>>(item: T, fallback: z.output<T>[] = []) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item))
    .transform((list) => (list.length ? list : fallback));

const intVar = (min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const boolVar = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const secret = z.string().min(1).optional();

/** Estimated USD per UTC day; unset means no cap. */
const usd = z.coerce.number().min(0).max(10_000);
const UNLIMITED = "unlimited";

/** `name:usd` overrides, comma separated; `name:unlimited` exempts a client. */
const budgetOverrides = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const out = new Map<string, number | undefined>();
    for (const entry of (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const at = entry.lastIndexOf(":");
      const name = entry.slice(0, at).trim();
      const value = entry.slice(at + 1).trim();
      const cap = usd.safeParse(value);
      if (at <= 0 || (value !== UNLIMITED && (!cap.success || value === ""))) {
        ctx.addIssue({ code: "custom", message: `"${entry}" is not name:usd or name:${UNLIMITED}` });
        continue;
      }
      out.set(name, value === UNLIMITED ? undefined : cap.data);
    }
    return out;
  });

/** OTel's standard `key=value,key2=value2` header list. */
const otlpHeaders = z
  .string()
  .optional()
  .transform((v) =>
    Object.fromEntries(
      (v ?? "")
        .split(",")
        // Split on the first "=" only: values may contain "=" (base64 padding).
        .map((pair) => {
          const at = pair.indexOf("=");
          return at < 0 ? [] : [pair.slice(0, at), pair.slice(at + 1)].map((s) => decodeURIComponent(s.trim()));
        })
        .filter((kv): kv is [string, string] => kv.length === 2 && kv[0] !== ""),
    ),
  );

export const EnvSchema = z.object({
  // Access
  MCPY_CLIENTS: z.string().optional(),
  ALLOW_ANONYMOUS: boolVar,
  ALLOWED_HOSTNAMES: csv(z.string().min(1)),
  /** Browser origins allowed to call /mcp (e.g. a web MCP client's host). */
  ALLOWED_ORIGIN_HOSTNAMES: csv(z.string().min(1)),

  // Routing between providers
  PAGE_PROVIDERS: csv(ProviderIdSchema, [ProviderId.Direct, ProviderId.CloudflareBrowser, ProviderId.Firecrawl, ProviderId.BrightData]),
  SEARCH_PROVIDERS: csv(ProviderIdSchema, [ProviderId.Serpent, ProviderId.Firecrawl, ProviderId.BrightData]),
  PAPER_PROVIDERS: csv(ProviderIdSchema, [ProviderId.OpenAlex, ProviderId.Arxiv, ProviderId.PubMed, ProviderId.SemanticScholar]),
  /** Marketplace listing APIs, the last resort for shopping sites no page source could fetch. */
  LISTING_PROVIDERS: csv(ProviderIdSchema, [ProviderId.Serpent]),
  /** Crypto market and network sources; the first with a value wins each field (network history first, then prices, then live network). */
  CRYPTO_PROVIDERS: csv(ProviderIdSchema, [ProviderId.CoinMetrics, ProviderId.Kaspa, ProviderId.Dash, ProviderId.Mempool, ProviderId.CoinGecko, ProviderId.MiningPoolStats]),

  // Limits
  ATTEMPT_TIMEOUT_MS: intVar(1_000, 300_000, 20_000),
  DEADLINE_MS: intVar(1_000, 600_000, 60_000),
  MAX_RESPONSE_BYTES: intVar(10_000, 50_000_000, 5_000_000),
  PAGE_CACHE_TTL_SECONDS: intVar(60, 30 * 86_400, 3_600),
  SEARCH_CACHE_TTL_SECONDS: intVar(60, 30 * 86_400, 900),
  PAPER_CACHE_TTL_SECONDS: intVar(60, 30 * 86_400, 86_400),
  THOROUGH_GRACE_MS: intVar(0, 120_000, 8_000),
  RETRIES: intVar(0, 5, 2),

  // Spending (estimated USD per client per UTC day; needs the BUDGET binding)
  DAILY_BUDGET_USD: usd.optional(),
  CLIENT_DAILY_BUDGETS_USD: budgetOverrides,

  // Owner alerts by Pushover (paid source out of credits or quota; a client reaching its cap)
  PUSHOVER_TOKEN: secret,
  PUSHOVER_USER: secret,
  /** Quiet time after a quota alert before the same provider and kind alert again. */
  ALERT_COOLDOWN_SECONDS: intVar(60, 7 * 86_400, 21_600),
  /** Percent of a client's daily cap at which it gets a "running low" alert (100 turns it off). */
  CAP_WARNING_PERCENT: intVar(1, 100, 80),

  // User agent
  DEFAULT_USER_AGENT: UserAgentProfileSchema.default(UserAgentProfile.Default),
  USER_AGENT_STRING: z.string().min(1).max(512).optional(),

  // Telemetry
  LOG_LEVEL: LogLevelSchema.default(LogLevel.Info),
  OTEL_SERVICE_NAME: z.string().min(1).default("mcpy"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: otlpHeaders,
  DEPLOYMENT_ENV: z.string().min(1).default("production"),

  // Provider credentials (a provider is enabled only when these are set)
  CF_ACCOUNT_ID: secret,
  CF_BROWSER_API_TOKEN: secret,
  CF_BROWSER_API_BASE: z.string().url().optional(),
  FIRECRAWL_API_KEY: secret,
  FIRECRAWL_API_URL: z.string().url().optional(),
  /** USD per Firecrawl credit on your plan, for cost estimates and caps (default: Hobby, $19 / 5,000). */
  FIRECRAWL_USD_PER_CREDIT: z.coerce.number().positive().max(1).optional(),
  BRIGHTDATA_API_KEY: secret,
  BRIGHTDATA_UNLOCKER_ZONE: secret,
  BRIGHTDATA_SERP_ZONE: secret,
  /** Serpent API (apiserpent.com): web, news and image search at $0.60 per 1,000 calls. */
  SERPENT_API_KEY: secret,
  /** Optional: OpenAlex works without it, on a small budget shared per IP. */
  OPENALEX_API_KEY: secret,
  /** CoinGecko demo key (free; shared with deepmine, 30 calls a minute). Keyless works on a small shared limit. */
  COINGECKO_API_KEY: secret,
  /** Semantic Scholar is enabled only with a key (anonymous calls are rate-limited). */
  SEMANTIC_SCHOLAR_API_KEY: secret,
  /** Optional: PubMed works without it (3 requests/s); a free NCBI key allows 10. */
  NCBI_API_KEY: secret,
  /** Optional contact address NCBI asks integrations to send. */
  NCBI_EMAIL: z.string().email().optional(),
});
export type ServerEnv = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
  }
}

const parsed = new WeakMap<object, ServerEnv>();

/** Parse once per env object (Workers reuse it across requests). */
export function loadEnv(env: Env): ServerEnv {
  const hit = parsed.get(env);
  if (hit) return hit;
  // Empty strings mean "unset" for optional vars.
  const raw = Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string" && v !== ""));
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  parsed.set(env, result.data);
  return result.data;
}
