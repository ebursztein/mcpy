import { AttemptOutcome, CacheStatus, ErrorCode, LogLevel, SearchMode, type UserAgentProfile } from "../enums.js";
import { McpyError } from "../errors.js";
import type { HttpClient } from "../http/client.js";
import { sha256Hex } from "../http/url.js";
import { resolveUserAgent, type UserAgentConfig } from "../http/user-agents.js";
import type { FetchedPage, FoundPage, PageProvider, PageRequest, ProviderCall, SearchProvider, SearchRequest } from "../providers/types.js";
import type { PaperProvider, PaperRequest } from "../providers/paper-types.js";
import type { CryptoProvider } from "../providers/crypto-types.js";
import type { ListingPage, ListingProvider, ListingRequest } from "../providers/listing-types.js";
import { Attr } from "../telemetry/attributes.js";
import type { Telemetry } from "../telemetry/telemetry.js";
import type { SpanContext } from "../telemetry/types.js";
import type { CircuitBreaker } from "./breaker.js";
import type { EngineLimits } from "./limits.js";
import { isYoungEnough, type Cache } from "./cache.js";
import { runChain, type ChainProvider, type ChainResult, type Judgement } from "./chain.js";
import { EMPTY_SEARCH_TTL_SECONDS, emptyMovesOn, searchCost } from "./judgements.js";
import { dedupe, mergeRanked, type MergedPage } from "./merge.js";
import { capableProviders } from "./search-routing.js";
import { capablePaperProviders, mergePapers, type MergedPaper } from "./papers.js";
import { fanOut } from "./fanout.js";
import { capablePageProviders, noCapableProvider, pageCacheKey, routeSite } from "./page-request.js";
import { assessPage } from "./quality.js";
import type { SpendMeter } from "./meter.js";
import type { QuotaAlert } from "./quota.js";
import { PaidFailures, SiteRoutes, targetHostAttributes } from "./routes.js";
import { isFree, noFreeProvider, runPageChain, type PagePolicy } from "./page-chain.js";
import { PagePins, type Pinned } from "./pins.js";

export { EngineLimitsSchema, type EngineLimits } from "./limits.js";
export type { PagePolicy } from "./page-chain.js";

const CACHE_VERSION = "v2";

export { EMPTY_SEARCH_TTL_SECONDS };

export interface EngineDeps {
  pageProviders: PageProvider[];
  searchProviders: SearchProvider[];
  paperProviders: PaperProvider[];
  /** Marketplace listing APIs: the last resort for sites whose pages no source could fetch. */
  listingProviders?: ListingProvider[];
  /** Crypto market and network sources (services/crypto). */
  cryptoProviders?: CryptoProvider[];
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
  /** Totals what the operation spends and enforces the caller's spending limit. */
  meter?: SpendMeter;
  onQuota?: (alert: QuotaAlert) => void; // a paid source refused a call for account reasons
  /** The caller's client name: a write's cached answer is kept for it alone. */
  client?: string;
}

/** Engine result. `provider` is for telemetry only; cost is totalled by the scope's meter. */
export interface Served<T> {
  value: T;
  cache: CacheStatus;
  attempts: number;
  provider: string;
  /** The provider that served each part of a call that has parts (shopping_search: each store's search). */
  parts?: Record<string, string>;
}

interface Cached<T> {
  value: T;
  provider: string;
  /** Epoch ms of the write; absent on entries written before it was recorded. */
  storedAt?: number;
}

/** Cache, fallback chain and provider plumbing behind every operation. */
export class Engine {
  private readonly routes: SiteRoutes;
  private readonly pins: PagePins;
  private readonly paidFailures: PaidFailures;

  constructor(private readonly deps: EngineDeps) {
    this.routes = new SiteRoutes(deps.cache, deps.limits.siteRouteTtlSeconds);
    this.pins = new PagePins(deps.cache, deps.limits.pageTtlSeconds);
    this.paidFailures = new PaidFailures(deps.cache, deps.limits.paidFailureTtlSeconds);
  }

  get providerIds() {
    return {
      pages: this.deps.pageProviders.map((p) => p.id),
      search: this.deps.searchProviders.map((p) => p.id),
      papers: this.deps.paperProviders.map((p) => p.id),
      listings: (this.deps.listingProviders ?? []).map((p) => p.id),
      crypto: this.cryptoProviders.map((p) => p.id),
    };
  }

  get cryptoProviders(): CryptoProvider[] {
    return this.deps.cryptoProviders ?? [];
  }

  /** Tunables an operation kept in its own module needs (grace period, cache lifetimes). */
  get limits(): EngineLimits {
    return this.deps.limits;
  }

  private pageKey(req: PageRequest, scope: Pick<CallScope, "client">): Promise<string> {
    return pageCacheKey(CACHE_VERSION, req, scope.client);
  }

  /** Keep this copy of a page so its later parts come from it; returns its version. */
  async pinPage(req: PageRequest, served: Served<FetchedPage>, scope: Pick<CallScope, "client">): Promise<string> {
    return this.pins.pin(await this.pageKey(req, scope), served.value, served.provider);
  }

  /** The pinned copy of a page with this version, if it is still kept. */
  async pinnedPage(req: PageRequest, version: string, scope: Pick<CallScope, "client">): Promise<Pinned | undefined> {
    return this.pins.recall(await this.pageKey(req, scope), version);
  }

  /** `maxAgeSeconds` (every cached operation): oldest cached answer to serve; 0 skips the cache. */
  async page(req: PageRequest, scope: CallScope, maxAgeSeconds: number, policy: PagePolicy = {}): Promise<Served<FetchedPage>> {
    const capable = capablePageProviders(this.deps.pageProviders, req);
    if (capable.length === 0) throw noCapableProvider(req);
    if (policy.freeOnly && !capable.some(isFree)) throw noFreeProvider();
    const key = await this.pageKey(req, scope);
    const ttl = () => this.deps.limits.pageTtlSeconds;
    return this.cached(key, ttl, maxAgeSeconds, scope, (deadlineAt) =>
      runPageChain({
        capable,
        site: routeSite(req),
        policy,
        routes: this.routes,
        failures: this.paidFailures,
        scope,
        run: (providers, onAttempt) =>
          runChain({
            providers,
            attempt: (p, signal, timeoutMs, parent) => {
              onAttempt(p);
              return p.fetchPage(req, this.call(signal, timeoutMs, deadlineAt, scope, parent));
            },
            judge: assessPage,
            // Which site each attempt was for, so hosts can report cost per domain.
            attributes: targetHostAttributes(req.url),
            describe: (page) => ({ [Attr.TargetStatus]: page.status, [Attr.ContentChars]: page.content.length }),
            ...this.chainCommon(deadlineAt, scope),
          }),
      }),
    );
  }

  /**
   * Fast mode: capable providers in order, first answer wins. Thorough mode:
   * every capable provider in parallel under the same deadline, results
   * merged by rank fusion. Every search parameter is part of the cache key.
   */
  async search(req: SearchRequest, mode: SearchMode, scope: CallScope, maxAgeSeconds: number): Promise<Served<MergedPage[]>> {
    const providers = capableProviders(this.deps.searchProviders, req);
    const identity = [mode, req.query.toLowerCase(), req.type, req.limit, req.page, req.country, req.language, req.recency, req.device, req.sites, req.excludeSites];
    const key = `${CACHE_VERSION}:search:${await sha256Hex(JSON.stringify(identity))}`;
    const ttl = (hits: MergedPage[]) => (hits.length ? this.deps.limits.searchTtlSeconds : EMPTY_SEARCH_TTL_SECONDS);
    return this.cached(key, ttl, maxAgeSeconds, scope, (deadlineAt) =>
      mode === SearchMode.Thorough ? this.searchAll(providers, req, deadlineAt, scope) : this.searchFirst(providers, req, deadlineAt, scope),
    );
  }

  private searchChain(providers: SearchProvider[], req: SearchRequest, deadlineAt: number, scope: CallScope) {
    return runChain({
      providers,
      attempt: (p, signal, timeoutMs, parent) => p.search(req, this.call(signal, timeoutMs, deadlineAt, scope, parent)),
      judge: emptyMovesOn,
      describe: (hits) => ({ [Attr.ContentChars]: hits.length }),
      cost: searchCost(req),
      ...this.chainCommon(deadlineAt, scope),
    });
  }

  private async searchFirst(providers: SearchProvider[], req: SearchRequest, deadlineAt: number, scope: CallScope): Promise<ChainResult<MergedPage[]>> {
    const result = await this.searchChain(providers, req, deadlineAt, scope);
    return { ...result, value: dedupe(result.value, req.limit) };
  }

  private async searchAll(providers: SearchProvider[], req: SearchRequest, deadlineAt: number, scope: CallScope): Promise<ChainResult<MergedPage[]>> {
    const merge = (lists: FoundPage[][]) => mergeRanked(lists, req.limit);
    return fanOut(providers, (p) => this.searchChain([p], req, deadlineAt, scope), merge, this.deps.limits.thoroughGraceMs, searchCost(req));
  }

  /** Paper search: same modes as web search, merged by DOI, arXiv id or title. */
  async papers(req: PaperRequest, mode: SearchMode, scope: CallScope, maxAgeSeconds: number): Promise<Served<MergedPaper[]>> {
    const providers = capablePaperProviders(this.deps.paperProviders, req);
    const identity = [mode, req.query?.toLowerCase(), req.author?.toLowerCase(), req.limit, req.page, req.yearFrom, req.yearTo, req.openAccess, req.sort, req.collection];
    const key = `${CACHE_VERSION}:papers:${await sha256Hex(JSON.stringify(identity))}`;
    const ttl = (hits: MergedPaper[]) => (hits.length ? this.deps.limits.paperTtlSeconds : EMPTY_SEARCH_TTL_SECONDS);
    const chain = (ps: PaperProvider[], deadlineAt: number) =>
      this.chain(ps, (p, call) => p.searchPapers(req, call), emptyMovesOn, deadlineAt, scope, (hits) => ({ [Attr.ContentChars]: hits.length }));
    return this.cached(key, ttl, maxAgeSeconds, scope, async (deadlineAt) => {
      if (mode === SearchMode.Thorough) {
        return fanOut(providers, (p) => chain([p], deadlineAt), (lists) => mergePapers(lists, req.limit, req.sort), this.deps.limits.thoroughGraceMs);
      }
      const result = await chain(providers, deadlineAt);
      return { ...result, value: mergePapers([result.value], req.limit, req.sort) };
    });
  }

  /** Whether some listing source can search this market. */
  servesListings(market: ListingRequest["market"]): boolean {
    return (this.deps.listingProviders ?? []).some((p) => p.markets.includes(market));
  }

  /** A marketplace's results from listing APIs, cached like the page they replace (continuations reread it). */
  async listings(req: ListingRequest, scope: CallScope, maxAgeSeconds: number): Promise<Served<ListingPage>> {
    const providers = (this.deps.listingProviders ?? []).filter((p) => p.markets.includes(req.market));
    if (!providers.length) throw new McpyError(ErrorCode.NoProviders, "no listing source serves this marketplace");
    const key = `${CACHE_VERSION}:listings:${await sha256Hex(JSON.stringify([req.market, req.query.toLowerCase(), req.sort, req.minPrice, req.maxPrice, req.page]))}`;
    const ttl = (p: ListingPage) => (p.rows.length ? this.deps.limits.pageTtlSeconds : EMPTY_SEARCH_TTL_SECONDS);
    return this.cached(key, ttl, maxAgeSeconds, scope, (deadlineAt) =>
      runChain({
        providers,
        attempt: (p, signal, timeoutMs, parent) => p.searchListings(req, this.call(signal, timeoutMs, deadlineAt, scope, parent)),
        judge: (p) => emptyMovesOn(p.rows),
        ...this.chainCommon(deadlineAt, scope),
      }),
    );
  }

  /** One fallback chain over `providers`, with the engine's timeouts, breaker, telemetry and spending limit. */
  chain<P extends ChainProvider, T>(providers: P[], attempt: (p: P, call: ProviderCall) => Promise<T>, judge: (value: T) => Judgement, deadlineAt: number, scope: CallScope, describe?: (value: T) => Record<string, number>): Promise<ChainResult<T>> {
    return runChain({ providers, attempt: (p, signal, timeoutMs, parent) => attempt(p, this.call(signal, timeoutMs, deadlineAt, scope, parent)), judge, describe, ...this.chainCommon(deadlineAt, scope) });
  }

  private chainCommon(deadlineAt: number, scope: CallScope) {
    return {
      attemptTimeoutMs: this.deps.limits.attemptTimeoutMs,
      deadlineAt,
      breaker: this.deps.breaker,
      telemetry: scope.telemetry,
      parent: scope.parent,
      meter: scope.meter,
      onQuota: scope.onQuota,
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
   * challenge pages never reach the cache); salvaged results are returned
   * but not cached. The write is deferred off the request path when possible.
   */
  async cached<T>(
    key: string,
    /** Seconds to cache the result, or undefined to not cache it. */
    ttl: (value: T, salvaged: boolean) => number | undefined,
    /** Oldest entry to serve; older ones are fetched again, and 0 skips the read. */
    maxAgeSeconds: number,
    scope: CallScope,
    run: (deadlineAt: number) => Promise<ChainResult<T>>,
  ): Promise<Served<T>> {
    const skip = maxAgeSeconds === 0;
    if (!skip) {
      const hit = await this.deps.cache.get<Cached<T>>(key);
      if (hit && isYoungEnough(hit, maxAgeSeconds)) return { value: hit.value, cache: CacheStatus.Hit, attempts: 0, provider: hit.provider };
    }
    const result = await run(Date.now() + this.deps.limits.deadlineMs);
    const seconds = ttl(result.value, result.salvaged);
    if (seconds !== undefined) {
      const write = this.deps.cache.put<Cached<T>>(key, { value: result.value, provider: result.provider, storedAt: Date.now() }, seconds).catch(() => undefined);
      if (scope.defer) scope.defer(write);
      else await write;
    }
    scope.telemetry.log(LogLevel.Debug, seconds === undefined ? "result not cached" : "cached result", { [Attr.Provider]: result.provider }, scope.parent);
    return {
      value: result.value,
      cache: skip ? CacheStatus.Bypass : CacheStatus.Miss,
      attempts: result.attempts.length,
      provider: result.provider,
    };
  }
}

