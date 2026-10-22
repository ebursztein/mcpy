/**
 * Worker env -> typed server config, validated with zod. Every setting is a
 * var or secret, so anyone can run their own deployment without code edits.
 */

import { LogLevel, LogLevelSchema, UserAgentProfile, UserAgentProfileSchema, type KvLike } from "mcpy";
import { ProviderId, ProviderIdSchema } from "mcpy/providers";
import type { AnalyticsDatasetLike } from "mcpy/telemetry";
import { z } from "zod";

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
  SEARCH_PROVIDERS: csv(ProviderIdSchema, [ProviderId.Firecrawl, ProviderId.BrightData]),

  // Limits
  ATTEMPT_TIMEOUT_MS: intVar(1_000, 300_000, 20_000),
  DEADLINE_MS: intVar(1_000, 600_000, 45_000),
  MAX_RESPONSE_BYTES: intVar(10_000, 50_000_000, 5_000_000),
  PAGE_CACHE_TTL_SECONDS: intVar(60, 30 * 86_400, 3_600),
  SEARCH_CACHE_TTL_SECONDS: intVar(60, 30 * 86_400, 900),
  RETRIES: intVar(0, 5, 2),

  // User agent
  DEFAULT_USER_AGENT: UserAgentProfileSchema.default(UserAgentProfile.Mcpy),
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
  BRIGHTDATA_API_KEY: secret,
  BRIGHTDATA_UNLOCKER_ZONE: secret,
  BRIGHTDATA_SERP_ZONE: secret,
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
