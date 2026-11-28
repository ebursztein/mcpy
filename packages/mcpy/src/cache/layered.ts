/**
 * LayeredCache: the one cache mcpy takes. The isolate's memory in front of
 * Cloudflare KV, presented as one store; callers never pick a layer.
 *
 * - Reads try memory first. Reads that reach KV in the same tick share one
 *   bulk get (up to 100 keys a request): a fetch whose page missed reads its
 *   site's route and paused flag in one KV round trip, not two. A KV hit is
 *   copied to memory.
 * - Writes go to both. With KV behind it, memory keeps an entry at most
 *   `memoryTtlSeconds` (default 60, KV's own propagation delay), so another
 *   isolate's change shows as soon as KV would show it.
 * - Memory keeps one deep-frozen copy of each entry, made from the same JSON
 *   text KV stores, so both layers serve the same value and a memory hit
 *   costs no parsing. Changing a served value throws instead of quietly
 *   changing what the next caller gets (SharedCache's schemas hand callers
 *   fresh objects anyway).
 * - Which layer answered is reported on every read's log record and counted
 *   per call (`mcpy.cache.reads.*`), so the hit rate of each is measurable.
 *
 * Without `kv` it is memory only (local dev, tests, Node); with
 * `memory: false` and no `kv` it keeps nothing.
 */
import type { z } from "zod";
import { enumOf } from "../enums.js";
import { KvStore, MemoryStore, type KvLike, type MemoryOptions } from "./store.js";

export type { KvLike, MemoryOptions } from "./store.js";

const cacheTier = enumOf({ Memory: "memory", Kv: "kv" } as const);
export const CacheTier = cacheTier.values;
export const CacheTierSchema = cacheTier.schema;
export type CacheTier = z.infer<typeof CacheTierSchema>;

export interface LayeredCacheOptions {
  /** A Cloudflare KV namespace (anything with its bulk get and put). Without it, entries live in memory only. */
  kv?: KvLike;
  /** Bounds of the memory layer, or false for none. */
  memory?: MemoryOptions | false;
  /** Longest an entry stays in memory while KV is behind it (default 60). */
  memoryTtlSeconds?: number;
}

/** A stored value and the layer it came from. */
export interface Found {
  value: unknown;
  tier: CacheTier;
}

export class LayeredCache {
  private readonly memory: MemoryStore | undefined;
  private readonly kv: KvStore | undefined;
  private readonly memoryTtlSeconds: number;
  private pending: { keys: Set<string>; texts: Promise<Map<string, string | null>> } | undefined;

  constructor(options: LayeredCacheOptions = {}) {
    this.memory = options.memory === false ? undefined : new MemoryStore(options.memory);
    this.kv = options.kv ? new KvStore(options.kv) : undefined;
    this.memoryTtlSeconds = options.memoryTtlSeconds ?? 60;
  }

  /** @internal The value under `key`, if any (SharedCache reads through this). May reject when KV fails. */
  read(key: string): Promise<Found | undefined> {
    const near = this.memory?.get(key);
    if (near !== undefined) return Promise.resolve({ value: near, tier: CacheTier.Memory });
    if (!this.kv) return Promise.resolve(undefined);
    return this.fromKv(key).then((text) => {
      if (text === null) return undefined;
      const value = deepFreeze(JSON.parse(text) as unknown);
      this.memory?.put(key, value, text.length, this.memoryTtlSeconds);
      return { value, tier: CacheTier.Kv };
    });
  }

  /** @internal Keep `value` under `key` for `ttlSeconds`. May reject when KV fails (memory keeps it). */
  async write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const body = JSON.stringify(value);
    // What KV would hand back, so memory and KV serve the same value.
    this.memory?.put(key, deepFreeze(JSON.parse(body) as unknown), body.length, this.kv ? Math.min(ttlSeconds, this.memoryTtlSeconds) : ttlSeconds);
    await this.kv?.put(key, body, ttlSeconds);
  }

  /** Every key asked for in this tick goes to KV in one bulk get. */
  private fromKv(key: string): Promise<string | null> {
    let batch = this.pending;
    if (!batch) {
      const keys = new Set<string>();
      const texts = Promise.resolve().then(() => {
        this.pending = undefined;
        return this.kv!.getMany([...keys]);
      });
      batch = this.pending = { keys, texts };
    }
    batch.keys.add(key);
    return batch.texts.then((found) => found.get(key) ?? null);
  }
}

/** Freeze a JSON value and everything in it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
