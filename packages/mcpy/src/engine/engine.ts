import { z } from "zod";
import { AttemptOutcome, CacheStatus, LogLevel, SearchMode, type UserAgentProfile } from "../enums.js";
import type { HttpClient } from "../http/client.js";
import { normalizeUrl, sha256Hex } from "../http/url.js";
import { resolveUserAgent, type UserAgentConfig } from "../http/user-agents.js";
import type { FetchedPage, FoundPage, PageProvider, PageRequest, ProviderCall, SearchProvider, SearchRequest } from "../providers/types.js";
import { Attr } from "../telemetry/attributes.js";
import type { Telemetry } from "../telemetry/telemetry.js";
import type { SpanContext } from "../telemetry/types.js";
import type { CircuitBreaker } from "./breaker.js";
import type { Cache } from "./cache.js";
import { runChain, type AttemptRecord, type ChainResult } from "./chain.js";
import { dedupe, mergeRanked, type MergedPage } from "./merge.js";
import { capableProviders } from "./search-routing.js";
import { assessPage } from "./quality.js";

export const EngineLimitsSchema = z.object({
  /** Upper bound for a single provider attempt. */
  attemptTimeoutMs: z.number().int().min(1_000).max(300_000).default(20_000),
  /** Upper bound for a whole operation, fallbacks and retries included. */
  deadlineMs: z.number().int().min(1_000).max(600_000).default(45_000),
  /** Largest upstream body read. */
  maxResponseBytes: z.number().int().min(10_000).max(50_000_000).default(5_000_000),
  pageTtlSeconds: z.number().int().min(60).max(30 * 86_400).default(3_600),
  searchTtlSeconds: z.number().int().min(60).max(30 * 86_400).default(900),
});
export type EngineLimits = z.infer<typeof EngineLimitsSchema>;

const CACHE_VERSION = "v2";

export interface EngineDeps {
  pageProviders: PageProvider[];
  searchProviders: SearchProvider[];
  cache: Cache;
  http: HttpClient;
  breaker: CircuitBreaker;
  limits: EngineLimits;
  userAgents: UserAgentConfig;
}

/** Telemetry scope and parent span of the operation being served. */
export interface CallScope {
  telemetry: Telemetry;
  parent: SpanContext;
  /** Runs background work after the response (e.g. a Worker's ctx.waitUntil). */
  defer?: (work: Promise<unknown>) => void;
}

/** Empty search results may be a transient upstream hiccup: keep them briefly. */
export const EMPTY_SEARCH_TTL_SECONDS = 60;

/** Engine result. `provider` and `costUsd` are for telemetry only. */
export interface Served<T> {
  value: T;
  cache: CacheStatus;
  attempts: number;
  provider: string;
  costUsd: number;
}

interface Cached<T> {
  value: T;
  provider: string;
}

/** Cache, fallback chain and provider plumbing behind every operation. */
export class Engine {
  constructor(private readonly deps: EngineDeps) {}

  get providerIds() {
    return { pages: this.deps.pageProviders.map((p) => p.id), search: this.deps.searchProviders.map((p) => p.id) };
  }

  async page(req: PageRequest, fresh: boolean, scope: CallScope): Promise<Served<FetchedPage>> {
    const key = `${CACHE_VERSION}:page:${req.format}:${req.userAgent}:${await sha256Hex(normalizeUrl(req.url))}`;
    return this.cached(key, () => this.deps.limits.pageTtlSeconds, fresh, scope, (deadlineAt) =>
      runChain({
        providers: this.deps.pageProviders,
        attempt: (p, signal, timeoutMs, parent) => p.fetchPage(req, this.call(signal, timeoutMs, deadlineAt, scope, parent)),
        judge: assessPage,
        describe: (page) => ({ [Attr.TargetStatus]: page.status, [Attr.ContentChars]: page.content.length }),
        ...this.chainCommon(deadlineAt, scope),
      }),
    );
  }

  /**
   * Fast mode: capable providers in order, first answer wins. Thorough mode:
   * every capable provider in parallel under the same deadline, results
   * merged by rank fusion. Every search parameter is part of the cache key.
   */
  async search(req: SearchRequest, mode: SearchMode, fresh: boolean, scope: CallScope): Promise<Served<MergedPage[]>> {
    const providers = capableProviders(this.deps.searchProviders, req);
    const identity = [mode, req.query.toLowerCase(), req.type, req.limit, req.page, req.country, req.language, req.recency, req.device, req.sites, req.excludeSites];
    const key = `${CACHE_VERSION}:search:${await sha256Hex(JSON.stringify(identity))}`;
    const ttl = (hits: MergedPage[]) => (hits.length ? this.deps.limits.searchTtlSeconds : EMPTY_SEARCH_TTL_SECONDS);
    return this.cached(key, ttl, fresh, scope, (deadlineAt) =>
      mode === SearchMode.Thorough ? this.searchAll(providers, req, deadlineAt, scope) : this.searchFirst(providers, req, deadlineAt, scope),
    );
  }

  private searchChain(providers: SearchProvider[], req: SearchRequest, deadlineAt: number, scope: CallScope) {
    return runChain({
      providers,
      attempt: (p, signal, timeoutMs, parent) => p.search(req, this.call(signal, timeoutMs, deadlineAt, scope, parent)),
      // Any answer from a search provider is final, even zero hits.
      judge: () => ({ outcome: AttemptOutcome.Ok }),
      describe: (hits) => ({ [Attr.ContentChars]: hits.length }),
      ...this.chainCommon(deadlineAt, scope),
    });
  }

  private async searchFirst(providers: SearchProvider[], req: SearchRequest, deadlineAt: number, scope: CallScope): Promise<ChainResult<MergedPage[]>> {
    const result = await this.searchChain(providers, req, deadlineAt, scope);
    return { ...result, value: dedupe(result.value, req.limit) };
  }

  private async searchAll(providers: SearchProvider[], req: SearchRequest, deadlineAt: number, scope: CallScope): Promise<ChainResult<MergedPage[]>> {
    const settled = await Promise.allSettled(providers.map((p) => this.searchChain([p], req, deadlineAt, scope)));
    const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
    const attempts: AttemptRecord[] = settled.flatMap((s, i) =>
      s.status === "fulfilled" ? s.value.attempts : [{ provider: providers[i].id, outcome: AttemptOutcome.Error, latencyMs: 0 }],
    );
    const costUsd = settled.reduce((sum, s, i) => sum + (s.status === "fulfilled" ? s.value.costUsd : providers[i].costPerCall), 0);
    return {
      value: mergeRanked(ok.map((r) => r.value), req.limit),
      provider: ok.map((r) => r.provider).join("+"),
      attempts,
      costUsd,
      salvaged: false,
    };
  }

  private chainCommon(deadlineAt: number, scope: CallScope) {
    return {
      attemptTimeoutMs: this.deps.limits.attemptTimeoutMs,
      deadlineAt,
      breaker: this.deps.breaker,
      telemetry: scope.telemetry,
      parent: scope.parent,
    };
  }

  private call(signal: AbortSignal, timeoutMs: number, deadlineAt: number, scope: CallScope, parent: SpanContext): ProviderCall {
    return {
      http: this.deps.http,
      context: { signal, deadlineAt, maxBytes: this.deps.limits.maxResponseBytes, telemetry: scope.telemetry, parent },
      userAgent: (profile: UserAgentProfile) => resolveUserAgent(profile, this.deps.userAgents),
      timeoutMs,
    };
  }

  /**
   * Serve from cache when possible; otherwise run the chain and cache the
   * result. The chain only returns usable or definitive results (blocked and
   * challenge pages never reach the cache); salvaged thin pages are returned
   * but not cached. The write is deferred off the request path when possible.
   */
  private async cached<T>(
    key: string,
    ttl: (value: T) => number,
    fresh: boolean,
    scope: CallScope,
    run: (deadlineAt: number) => Promise<ChainResult<T>>,
  ): Promise<Served<T>> {
    if (!fresh) {
      const hit = await this.deps.cache.get<Cached<T>>(key);
      if (hit) return { value: hit.value, cache: CacheStatus.Hit, attempts: 0, provider: hit.provider, costUsd: 0 };
    }
    const result = await run(Date.now() + this.deps.limits.deadlineMs);
    if (!result.salvaged) {
      const write = this.deps.cache.put<Cached<T>>(key, { value: result.value, provider: result.provider }, ttl(result.value)).catch(() => undefined);
      if (scope.defer) scope.defer(write);
      else await write;
    }
    scope.telemetry.log(LogLevel.Debug, result.salvaged ? "served salvaged result (not cached)" : "cached result", { [Attr.Provider]: result.provider }, scope.parent);
    return {
      value: result.value,
      cache: fresh ? CacheStatus.Bypass : CacheStatus.Miss,
      attempts: result.attempts.length,
      provider: result.provider,
      costUsd: result.costUsd,
    };
  }
}
