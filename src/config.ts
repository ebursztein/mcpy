/**
 * Runtime configuration. Everything deployment-specific comes from Worker
 * vars/secrets so anyone can deploy their own instance without code changes.
 */

export interface Env {
  // Bindings (all optional: features degrade gracefully when absent).
  CACHE?: KVNamespace;
  TELEMETRY?: AnalyticsEngineDataset;

  // Access control.
  AUTH_TOKENS?: string; // comma-separated bearer tokens (secret)
  ALLOW_ANONYMOUS?: string; // "true" to serve without auth (local dev only)
  ALLOWED_HOSTNAMES?: string; // comma-separated Host headers to accept

  // Routing.
  FETCH_PROVIDERS?: string; // ordered fallback chain, comma-separated ids
  SEARCH_PROVIDERS?: string;

  // Limits and caching.
  FETCH_TIMEOUT_MS?: string;
  MAX_RESPONSE_BYTES?: string;
  CACHE_TTL_SECONDS?: string;
  SEARCH_CACHE_TTL_SECONDS?: string;
  USER_AGENT?: string;

  // Provider credentials (secrets). A provider is enabled only when its
  // credentials are present.
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_API_TOKEN?: string;
  CF_BROWSER_API_BASE?: string; // override; "{account}" is substituted
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_API_URL?: string; // override for self-hosted Firecrawl
  BRIGHTDATA_API_KEY?: string;
  BRIGHTDATA_UNLOCKER_ZONE?: string;
  BRIGHTDATA_SERP_ZONE?: string;

  // Per-call cost estimates in USD, used for telemetry only.
  COST_CF_BROWSER?: string;
  COST_FIRECRAWL_FETCH?: string;
  COST_FIRECRAWL_SEARCH?: string;
  COST_BRIGHTDATA_FETCH?: string;
  COST_BRIGHTDATA_SEARCH?: string;
}

export interface Config {
  authTokens: string[];
  allowAnonymous: boolean;
  allowedHostnames?: string[];
  fetchProviders: string[];
  searchProviders: string[];
  fetchTimeoutMs: number;
  maxResponseBytes: number;
  cacheTtlSeconds: number;
  searchCacheTtlSeconds: number;
  userAgent: string;
}

export const DEFAULT_FETCH_PROVIDERS = ["cf_fetch", "cf_browser", "firecrawl", "brightdata"];
export const DEFAULT_SEARCH_PROVIDERS = ["firecrawl", "brightdata"];

// KV rejects expirationTtl below 60 seconds.
const MIN_CACHE_TTL = 60;

export function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function int(value: string | undefined, fallback: number, min = 0): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function num(value: string | undefined, fallback: number): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: Env): Config {
  const fetchProviders = list(env.FETCH_PROVIDERS);
  const searchProviders = list(env.SEARCH_PROVIDERS);
  const allowedHostnames = list(env.ALLOWED_HOSTNAMES);
  return {
    authTokens: list(env.AUTH_TOKENS),
    allowAnonymous: env.ALLOW_ANONYMOUS === "true",
    allowedHostnames: allowedHostnames.length ? allowedHostnames : undefined,
    fetchProviders: fetchProviders.length ? fetchProviders : DEFAULT_FETCH_PROVIDERS,
    searchProviders: searchProviders.length ? searchProviders : DEFAULT_SEARCH_PROVIDERS,
    fetchTimeoutMs: int(env.FETCH_TIMEOUT_MS, 20_000, 1_000),
    maxResponseBytes: int(env.MAX_RESPONSE_BYTES, 5_000_000, 10_000),
    cacheTtlSeconds: int(env.CACHE_TTL_SECONDS, 3_600, MIN_CACHE_TTL),
    searchCacheTtlSeconds: int(env.SEARCH_CACHE_TTL_SECONDS, 900, MIN_CACHE_TTL),
    userAgent: env.USER_AGENT || "Mozilla/5.0 (compatible; toolshed/0.1; +https://github.com/ebursztein/toolshed)",
  };
}
