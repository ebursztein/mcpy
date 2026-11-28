/**
 * The one way mcpy reads and writes its cache.
 *
 * - Every entry lives in a space (spaces.ts) and is stored in one envelope:
 *   the value, the provider that produced it and the write time.
 * - Reads validate the envelope and the value (every space has a schema),
 *   apply the caller's `max_age`, and never throw: a backend error, a bad
 *   value or a stale one is a miss.
 * - Every read and write is reported on the call's telemetry: one debug log
 *   per event naming the space, key, event, the layer that answered, age and
 *   TTL; backend failures and invalid entries are warnings. Run with
 *   LOG_LEVEL=debug to follow the cache through a call. A call's reads are
 *   also counted by outcome (CacheReads) for the hit rate of each layer.
 */
import { z } from "zod";
import { enumOf, LogLevel } from "../enums.js";
import { sha256Hex } from "../http/url.js";
import { Attr } from "../telemetry/attributes.js";
import type { Telemetry } from "../telemetry/telemetry.js";
import type { Attributes, SpanContext } from "../telemetry/types.js";
import { inspectEntry, type CacheInspection } from "./inspect.js";
import type { LayeredCache } from "./layered.js";
import { cacheKey, type CacheSpace } from "./spaces.js";

const cacheEvent = enumOf({
  Hit: "hit",
  Miss: "miss",
  /** Found, but older than the caller accepts. */
  Stale: "stale",
  /** Found, but not in the shape its space stores (or not an envelope). */
  Invalid: "invalid",
  /** Not read: the caller asked for a fresh answer (max_age 0). */
  Bypass: "bypass",
  Stored: "stored",
  /** The backend threw on a read or a write. */
  Failed: "failed",
} as const);
export const CacheEvent = cacheEvent.values;
export const CacheEventSchema = cacheEvent.schema;
export type CacheEvent = z.infer<typeof CacheEventSchema>;

/** A call's cache reads by outcome: answered from memory, from KV, or not at all (miss, stale, invalid, failed). */
export class CacheReads {
  memory = 0;
  kv = 0;
  missed = 0;

  attributes(): Attributes {
    return { [Attr.CacheReadsMemory]: this.memory, [Attr.CacheReadsKv]: this.kv, [Attr.CacheReadsMissed]: this.missed };
  }
}

/** Where cache events are reported, and how a write can run after the response. A CallScope is one. */
export interface CacheContext {
  telemetry: Telemetry;
  parent?: SpanContext;
  /** Runs a write after the response (a Worker's ctx.waitUntil); without it writes are awaited. */
  defer?: (work: Promise<unknown>) => void;
  /** Counts this call's reads. */
  reads?: CacheReads;
  /** The request this call serves (its id): KV reads are gathered only within one request. */
  group?: string;
}

/** What a read returns: the value, the provider that produced it and its write time (absent on old entries). */
export interface CacheEntry<T> {
  value: T;
  provider?: string;
  storedAt?: number;
}

const EnvelopeSchema = z.object({ value: z.unknown(), provider: z.string().optional(), storedAt: z.number().optional() });

/** An id built from parts that are too long or too varied to read: a hash of their JSON. */
export function hashedId(parts: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(parts));
}

export class SharedCache {
  constructor(private readonly store: LayeredCache) {}

  /** One entry by its full key, for operators (cache/inspect.ts). Never throws. */
  inspect(key: string): Promise<CacheInspection> {
    return inspectEntry(this.store, key);
  }

  /** Entry `id` of `space`, if it is there, valid and at most `maxAgeSeconds` old (default: any age; 0 skips the read). */
  async read<T>(space: CacheSpace<T>, id: string, ctx?: CacheContext, maxAgeSeconds = Number.POSITIVE_INFINITY): Promise<CacheEntry<T> | undefined> {
    const key = cacheKey(space, id);
    if (maxAgeSeconds <= 0) return void report(ctx, space, key, CacheEvent.Bypass);
    // Called before any await, so reads issued together share one KV request.
    const lookup = this.store.read(key, ctx?.group);
    const missed = (event: CacheEvent, extra: Attributes = {}) => {
      if (ctx?.reads) ctx.reads.missed++;
      report(ctx, space, key, event, extra);
    };
    let found: Awaited<typeof lookup>;
    try {
      found = await lookup;
    } catch (err) {
      return void missed(CacheEvent.Failed, errorAttributes(err));
    }
    if (!found) return void missed(CacheEvent.Miss);
    const tier = { [Attr.CacheTier]: found.tier };
    const envelope = EnvelopeSchema.safeParse(found.value);
    const value = envelope.success ? space.schema.safeParse(envelope.data.value) : undefined;
    if (!value?.success) return void missed(CacheEvent.Invalid, tier);
    const { provider, storedAt } = envelope.data!;
    const age: Attributes = storedAt === undefined ? tier : { ...tier, [Attr.CacheAgeSeconds]: Math.round((Date.now() - storedAt) / 1000) };
    if (storedAt !== undefined && Date.now() - storedAt > maxAgeSeconds * 1000) return void missed(CacheEvent.Stale, age);
    if (ctx?.reads) ctx.reads[found.tier]++;
    report(ctx, space, key, CacheEvent.Hit, age);
    return { value: value.data, provider, storedAt };
  }

  /**
   * Store `value` as entry `id` of `space` for `ttlSeconds`. Never throws. Runs
   * after the response when the context can defer; pass a context without
   * `defer` when the next request may read the entry right away.
   */
  async write<T>(space: CacheSpace<T>, id: string, value: T, ttlSeconds: number, ctx?: CacheContext, provider?: string): Promise<void> {
    const key = cacheKey(space, id);
    const work = this.store
      .write(key, { value, provider, storedAt: Date.now() } satisfies CacheEntry<T>, ttlSeconds)
      .then(() => report(ctx, space, key, CacheEvent.Stored, { [Attr.CacheTtlSeconds]: ttlSeconds }))
      .catch((err: unknown) => report(ctx, space, key, CacheEvent.Failed, errorAttributes(err)));
    if (ctx?.defer) ctx.defer(work);
    else await work;
  }
}

function report(ctx: CacheContext | undefined, space: CacheSpace<unknown>, key: string, event: CacheEvent, extra: Attributes = {}): void {
  if (!ctx) return;
  const level = event === CacheEvent.Failed || event === CacheEvent.Invalid ? LogLevel.Warn : LogLevel.Debug;
  const attributes = { [Attr.CacheName]: space.name, [Attr.CacheKey]: key, [Attr.CacheEvent]: event, ...extra };
  ctx.telemetry.log(level, `cache ${event}`, attributes, ctx.parent);
}

function errorAttributes(err: unknown): Attributes {
  return { [Attr.ErrorType]: err instanceof Error ? err.name : "unknown", "exception.message": (err instanceof Error ? err.message : String(err)).slice(0, 300) };
}
