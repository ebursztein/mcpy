import { z } from "zod";
import { fetchOp, grepOp, searchOp } from "./api/operations.js";
import { papersOp } from "./api/papers.js";
import { PaperSearchInputSchema, type PaperSearchInput, type PaperSearchResult } from "./schemas-papers.js";
import type { PaperProvider } from "./providers/paper-types.js";
import { BreakerPolicySchema, CircuitBreaker } from "./engine/breaker.js";
import { MemoryCache, type Cache } from "./engine/cache.js";
import { Engine, EngineLimitsSchema, type CallScope, type Served } from "./engine/engine.js";
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
  /** Defaults to an in-memory cache. */
  cache?: Cache;
  /** Defaults to no telemetry. */
  telemetry?: Telemetry;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Who is calling and how; lands on every span and log record. */
export interface CallContext {
  client?: string;
  requestId?: string;
  transport?: Transport;
  parent?: SpanContext;
  /** Background work after the response, e.g. a Worker's ctx.waitUntil (keeps cache writes off the request path). */
  defer?: (work: Promise<unknown>) => void;
}

/** The SDK. Implements the same McpyApi as the REST client. */
export class Mcpy implements McpyApi {
  constructor(
    private readonly engine: Engine,
    private readonly telemetry: Telemetry,
    private readonly defaultUserAgent: UserAgentProfile,
    private readonly context: CallContext = {},
  ) {}

  /** A view of this instance bound to a caller (client name, request id, ...). */
  with(context: CallContext): Mcpy {
    return new Mcpy(this.engine, this.telemetry, this.defaultUserAgent, { ...this.context, ...context });
  }

  /**
   * Same engine (cache, circuit breaker) with different telemetry, e.g. a
   * per-request exporter on a server that flushes after each response.
   */
  withTelemetry(telemetry: Telemetry): Mcpy {
    return new Mcpy(this.engine, telemetry, this.defaultUserAgent, this.context);
  }

  fetch(input: FetchInput): Promise<FetchResult> {
    return this.run(Operation.Fetch, FetchInputSchema, input, (i, scope) => fetchOp(this.engine, i, this.defaultUserAgent, scope));
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
    try {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const details = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
        throw new McpyError(ErrorCode.InvalidInput, "invalid input", details);
      }
      const target = targetAttributes(parsed.data);
      span.setAttributes(target);
      const { result, served, outputChars } = await fn(parsed.data, { telemetry, parent: span.context, defer: this.context.defer });
      const facts = {
        [Attr.Cache]: served.cache,
        [Attr.Attempts]: served.attempts,
        [Attr.Provider]: served.provider,
        [Attr.CostUsd]: served.costUsd,
        [Attr.OutputChars]: outputChars,
        ...target,
      };
      span.setAttributes(facts);
      span.end(SpanStatus.Ok);
      telemetry.log(LogLevel.Info, `${operation} ok`, facts, span.context);
      return result;
    } catch (err) {
      const error = toMcpyError(err);
      // Telemetry keeps the original detail; callers get the sanitized error.
      const detail = err instanceof Error ? err.message : String(err);
      span.recordError(err);
      span.setAttributes({ [Attr.ErrorType]: error.code });
      span.end(SpanStatus.Error, detail);
      const level = error.httpStatus >= 500 ? LogLevel.Error : LogLevel.Warn;
      telemetry.log(level, `${operation} failed`, { [Attr.ErrorType]: error.code, [Attr.Reason]: detail.slice(0, 500) }, span.context);
      throw error;
    }
  }
}

/** Host and user-agent profile of a validated input, for spans and metrics. */
function targetAttributes(input: unknown): Record<string, string> {
  const { url, user_agent } = input as { url?: string; user_agent?: string };
  const out: Record<string, string> = {};
  if (url) {
    try {
      out[Attr.TargetHost] = new URL(url).host;
    } catch {
      // invalid URLs are rejected later with invalid_target
    }
  }
  if (user_agent) out[Attr.UserAgentProfile] = user_agent;
  return out;
}

/** Build the SDK from providers and (validated) settings. */
export function createMcpy(options: McpyOptions = {}): Mcpy {
  const config = McpyConfigSchema.parse({ limits: options.limits, retry: options.retry, breaker: options.breaker, userAgent: options.userAgent });
  const engine = new Engine({
    pageProviders: options.pages ?? [],
    searchProviders: options.search ?? [],
    paperProviders: options.papers ?? [],
    cache: options.cache ?? new MemoryCache(),
    http: new HttpClient({ fetch: options.fetch ?? globalThis.fetch.bind(globalThis), retry: config.retry }),
    breaker: new CircuitBreaker(config.breaker),
    limits: config.limits,
    userAgents: { defaultProfile: config.userAgent.default, customString: config.userAgent.custom },
  });
  return new Mcpy(engine, options.telemetry ?? Telemetry.noop(), config.userAgent.default);
}
