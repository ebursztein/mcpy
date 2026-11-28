import { z } from "zod";
import { fetchOp, grepOp, searchOp } from "./api/operations.js";
import { runFetchBatch } from "./api/batch.js";
import type { FetchBatchInput, FetchBatchResult } from "./schemas-batch.js";
import type { ScriptRunner } from "./api/script.js";
import { papersOp } from "./api/papers.js";
import { shoppingItemOp } from "./services/shopping/item.js";
import { shoppingSearchOp } from "./services/shopping/service.js";
import {
  ShoppingItemInputSchema,
  ShoppingSearchInputSchema,
  type ShoppingItemInput,
  type ShoppingItemResult,
  type ShoppingSearchInput,
  type ShoppingSearchResult,
} from "./services/shopping/schema.js";
import { PaperSearchInputSchema, type PaperSearchInput, type PaperSearchResult } from "./schemas-papers.js";
import type { PaperProvider } from "./providers/paper-types.js";
import type { ListingProvider } from "./providers/listing-types.js";
import type { CryptoProvider } from "./providers/crypto-types.js";
import { CryptoCoinInputSchema, CryptoMarketInputSchema, type CryptoCoinInput, type CryptoCoinResult, type CryptoMarketInput, type CryptoMarketResult } from "./schemas-crypto.js";
import { cryptoCoinOp } from "./services/crypto/coin.js";
import { cryptoMarketOp } from "./services/crypto/market.js";
import { BreakerPolicySchema, CircuitBreaker } from "./engine/breaker.js";
import type { CacheInspection } from "./cache/inspect.js";
import { LayeredCache } from "./cache/layered.js";
import { CacheReads } from "./cache/shared.js";
import { targetAttributes, withCost } from "./api/call-meta.js";
import { Engine, EngineLimitsSchema, type CallScope, type Served } from "./engine/engine.js";
import { SpendMeter, type SpendLimit } from "./engine/meter.js";
import type { QuotaAlert, QuotaAlertSink } from "./engine/quota.js";
import { ErrorCode, LogLevel, Operation, SpanName, SpanStatus, Transport, UserAgentProfile, UserAgentProfileSchema } from "./enums.js";
import { McpyError, toMcpyError } from "./errors.js";
import { HttpClient } from "./http/client.js";
import { RetryPolicySchema } from "./http/retry.js";
import type { PageProvider, SearchProvider } from "./providers/types.js";
import {
  FetchInputSchema,
  GrepInputSchema,
  SearchInputSchema,
  type FetchInput,
  type FetchResult,
  type GrepInput,
  type GrepResult,
  type McpyApi,
  type SearchInput,
  type SearchResult,
} from "./schemas.js";
import { Attr } from "./telemetry/attributes.js";
import { Telemetry } from "./telemetry/telemetry.js";
import type { SpanContext } from "./telemetry/types.js";

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
  /** Defaults to a memory-only LayeredCache; give it `kv` to share entries across isolates. */
  cache?: LayeredCache;
  /** Defaults to no telemetry. */
  telemetry?: Telemetry;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Runs fetch scripts; without one, fetch rejects `script`. */
  scripts?: ScriptRunner;
}

/** Who is calling and how; lands on every span and log record. */
export interface CallContext {
  client?: string;
  requestId?: string;
  transport?: Transport;
  parent?: SpanContext;
  /** Background work after the response, e.g. a Worker's ctx.waitUntil (keeps cache writes off the request path). */
  defer?: (work: Promise<unknown>) => void;
  /** Caps this caller's spending on paid sources; free sources and the cache stay available. */
  spendLimit?: SpendLimit;
  /** Told when a paid source runs out of credits or quota; runs off the request path when `defer` is set. */
  onQuota?: QuotaAlertSink;
  /** Told which provider served a successful call (and each part of it), for the host's own records; callers never see it. */
  onServed?: (served: { provider: string; parts?: Record<string, string> }) => void;
}

/** The SDK. Implements the same McpyApi as the REST client. */
export class Mcpy implements McpyApi {
  constructor(
    private readonly engine: Engine,
    private readonly telemetry: Telemetry,
    private readonly defaultUserAgent: UserAgentProfile,
    private readonly scripts: ScriptRunner | undefined,
    private readonly context: CallContext = {},
  ) {}

  /** A view of this instance bound to a caller (client name, request id, ...). */
  with(context: CallContext): Mcpy {
    return new Mcpy(this.engine, this.telemetry, this.defaultUserAgent, this.scripts, { ...this.context, ...context });
  }

  /**
   * Same engine (cache, circuit breaker) with different telemetry, e.g. a
   * per-request exporter on a server that flushes after each response.
   */
  withTelemetry(telemetry: Telemetry): Mcpy {
    return new Mcpy(this.engine, telemetry, this.defaultUserAgent, this.scripts, this.context);
  }

  fetch(input: FetchInput): Promise<FetchResult> {
    return this.run(Operation.Fetch, FetchInputSchema, input, (i, scope) => fetchOp(this.engine, i, this.defaultUserAgent, scope, this.scripts));
  }

  /** Each request is a fetch of its own: its own cache, spending, span and log line. */
  fetchBatch(input: FetchBatchInput): Promise<FetchBatchResult> {
    return runFetchBatch((request) => this.fetch(request), input);
  }

  grep(input: GrepInput): Promise<GrepResult> {
    return this.run(Operation.Grep, GrepInputSchema, input, (i, scope) => grepOp(this.engine, i, this.defaultUserAgent, scope));
  }

  search(input: SearchInput): Promise<SearchResult> {
    return this.run(Operation.Search, SearchInputSchema, input, (i, scope) => searchOp(this.engine, i, scope));
  }

  papers(input: PaperSearchInput): Promise<PaperSearchResult> {
    return this.run(Operation.Papers, PaperSearchInputSchema, input, (i, scope) => papersOp(this.engine, i, scope));
  }

  shopping(input: ShoppingSearchInput): Promise<ShoppingSearchResult> {
    return this.run(Operation.Shopping, ShoppingSearchInputSchema, input, (i, scope) => shoppingSearchOp(this.engine, i, scope));
  }

  shoppingItem(input: ShoppingItemInput): Promise<ShoppingItemResult> {
    return this.run(Operation.ShoppingItem, ShoppingItemInputSchema, input, (i, scope) => shoppingItemOp(this.engine, i, scope));
  }

  cryptoMarket(input: CryptoMarketInput): Promise<CryptoMarketResult> {
    return this.run(Operation.CryptoMarket, CryptoMarketInputSchema, input, (i, scope) => cryptoMarketOp(this.engine, i, scope));
  }

  cryptoCoin(input: CryptoCoinInput): Promise<CryptoCoinResult> {
    return this.run(Operation.CryptoCoin, CryptoCoinInputSchema, input, (i, scope) => cryptoCoinOp(this.engine, i, scope));
  }

  /**
   * Operators only: one cache entry by its full key (a log's `mcpy.cache.key`),
   * naming the provider that produced it. Not part of McpyApi, never a tool.
   */
  inspectCache(key: string): Promise<CacheInspection> {
    return this.engine.cache.inspect(key);
  }

  /** Validation, span, structured log line and error mapping for every operation. */
  private async run<S extends z.ZodType, R>(
    operation: Operation,
    schema: S,
    raw: unknown,
    fn: (input: z.infer<S>, scope: CallScope) => Promise<{ result: R; served: Served<unknown>; outputChars: number }>,
  ): Promise<R> {
    const telemetry = this.telemetry.with({
      [Attr.Operation]: operation,
      [Attr.Transport]: this.context.transport ?? Transport.Sdk,
      ...(this.context.client ? { [Attr.ClientName]: this.context.client } : {}),
      ...(this.context.requestId ? { [Attr.RequestId]: this.context.requestId } : {}),
    });
    const span = telemetry.startSpan(SpanName.Operation, {}, this.context.parent);
    const reads = new CacheReads();
    const meter = new SpendMeter(this.context.spendLimit, (err) =>
      telemetry.log(LogLevel.Error, "spending limit unavailable, allowing paid sources", { [Attr.Reason]: err instanceof Error ? err.message : String(err) }, span.context),
    );
    try {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const details = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
        throw new McpyError(ErrorCode.InvalidInput, "invalid input", details);
      }
      const target = targetAttributes(parsed.data);
      span.setAttributes(target);
      const { result, served, outputChars } = await fn(parsed.data, {
        telemetry,
        parent: span.context,
        defer: this.context.defer,
        meter,
        onQuota: this.quotaReporter(telemetry, span.context),
        reads,
        ...(this.context.client ? { client: this.context.client } : {}),
      });
      const facts = {
        ...reads.attributes(),
        [Attr.Cache]: served.cache,
        [Attr.Attempts]: served.attempts,
        [Attr.Provider]: served.provider,
        [Attr.CostUsd]: meter.spentUsd,
        [Attr.OutputChars]: outputChars,
        ...target,
      };
      span.setAttributes(facts);
      span.end(SpanStatus.Ok);
      this.context.onServed?.({ provider: served.provider, ...(served.parts ? { parts: served.parts } : {}) });
      withCost(result, meter.spentUsd);
      telemetry.log(LogLevel.Info, `${operation} ok`, facts, span.context);
      return result;
    } catch (err) {
      const error = toMcpyError(err);
      // Telemetry keeps the original detail; callers get the sanitized error.
      const detail = err instanceof Error ? err.message : String(err);
      span.recordError(err);
      // Failed operations still cost what their attempts cost. Set before end(): a span ignores writes after it.
      span.setAttributes({ [Attr.ErrorType]: error.code, [Attr.CostUsd]: meter.spentUsd, ...reads.attributes() });
      span.end(SpanStatus.Error, detail);
      const level = error.httpStatus >= 500 ? LogLevel.Error : LogLevel.Warn;
      telemetry.log(level, `${operation} failed`, { [Attr.ErrorType]: error.code, [Attr.CostUsd]: meter.spentUsd, [Attr.Reason]: detail.slice(0, 500) }, span.context);
      throw error;
    } finally {
      await this.recordSpend(meter, telemetry, span.context);
    }
  }

  /** Hand quota alerts to the host's sink; a failing sink is logged, never seen by the caller. */
  private quotaReporter(telemetry: Telemetry, parent: SpanContext): ((alert: QuotaAlert) => void) | undefined {
    const sink = this.context.onQuota;
    if (!sink) return undefined;
    return (alert) => {
      telemetry.log(LogLevel.Warn, "paid source quota", { [Attr.Provider]: alert.provider, [Attr.Reason]: `${alert.kind} (HTTP ${alert.status})` }, parent);
      const work = Promise.resolve()
        .then(() => sink(alert))
        .catch((err: unknown) => telemetry.log(LogLevel.Error, "quota alert failed", { [Attr.Reason]: err instanceof Error ? err.message : String(err) }, parent));
      if (this.context.defer) this.context.defer(work);
      else void work;
    };
  }

  /** Report what the operation spent to the caller's limit, off the request path when possible. */
  private async recordSpend(meter: SpendMeter, telemetry: Telemetry, parent: SpanContext): Promise<void> {
    const limit = this.context.spendLimit;
    if (!limit || meter.spentUsd <= 0) return;
    const write = limit.record(meter.spentUsd).catch((err: unknown) => {
      telemetry.log(LogLevel.Error, "could not record spending", { [Attr.CostUsd]: meter.spentUsd, [Attr.Reason]: err instanceof Error ? err.message : String(err) }, parent);
    });
    if (this.context.defer) this.context.defer(write);
    else await write;
  }
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
    cache: options.cache ?? new LayeredCache(),
    http: new HttpClient({ fetch: options.fetch ?? globalThis.fetch.bind(globalThis), retry: config.retry }),
    breaker: new CircuitBreaker(config.breaker),
    limits: config.limits,
    userAgents: { defaultProfile: config.userAgent.default, customString: config.userAgent.custom },
  });
  return new Mcpy(engine, options.telemetry ?? Telemetry.noop(), config.userAgent.default, options.scripts);
}
