/**
 * The two stores behind LayeredCache (layered.ts), internal to the cache
 * module: the isolate's memory and Cloudflare KV. They only keep JSON values
 * with a TTL; keys, envelopes, validation and reporting belong to
 * SharedCache (shared.ts). KV may throw; SharedCache reports it as a miss.
 */

/** The subset of a Cloudflare KV namespace the cache needs: bulk reads (as text) and writes. */
export interface KvLike {
  get(keys: string[], type: "text"): Promise<Map<string, string | null>>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

// KV values are capped at 25 MiB; stay well under it.
const KV_MAX_VALUE_BYTES = 20 * 1024 * 1024;
// KV rejects expirationTtl below 60 seconds.
const KV_MIN_TTL = 60;
// KV reads at most 100 keys in one bulk get.
export const KV_MAX_BULK_KEYS = 100;

export class KvStore {
  constructor(private readonly kv: KvLike) {}

  /** Every key's JSON text (null when absent), in bulk reads of up to 100 keys. */
  async getMany(keys: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    for (let i = 0; i < keys.length; i += KV_MAX_BULK_KEYS) {
      const found = await this.kv.get(keys.slice(i, i + KV_MAX_BULK_KEYS), "text");
      for (const [key, value] of found) out.set(key, value ?? null);
    }
    return out;
  }

  async put(key: string, body: string, ttlSeconds: number): Promise<void> {
    // Measure UTF-8 bytes, not UTF-16 code units.
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > KV_MAX_VALUE_BYTES) throw new Error(`value is ${bytes} bytes, over the ${KV_MAX_VALUE_BYTES}-byte KV limit`);
    await this.kv.put(key, body, { expirationTtl: Math.max(KV_MIN_TTL, ttlSeconds) });
  }
}

/** Bounds of the memory layer. Sizes are characters of JSON, measured once per write. */
export interface MemoryOptions {
  /** Most entries kept (default 1000). */
  maxEntries?: number;
  /** Most characters kept in all; least recently used entries go first. Unbounded when unset. */
  maxChars?: number;
  /** Entries longer than this are not kept in memory. Unbounded when unset. */
  maxEntryChars?: number;
}

/** An LRU of values with TTLs, sized by their JSON text. Synchronous, so reads issued together reach KV together. */
export class MemoryStore {
  private readonly store = new Map<string, { value: unknown; chars: number; expires: number }>();
  private readonly maxEntries: number;
  private chars = 0;

  constructor(private readonly options: MemoryOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
  }

  get(key: string): unknown {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    this.drop(key);
    if (hit.expires < Date.now()) return undefined;
    // Re-insert so iteration order is least-recently-used first.
    this.keep(key, hit);
    return hit.value;
  }

  /** Keep `value`, whose JSON text is `chars` long. */
  put(key: string, value: unknown, chars: number, ttlSeconds: number): void {
    this.drop(key);
    if (this.options.maxEntryChars !== undefined && chars > this.options.maxEntryChars) return;
    const max = this.options.maxChars;
    while (this.store.size > 0 && (this.store.size >= this.maxEntries || (max !== undefined && this.chars + chars > max))) {
      this.drop(this.store.keys().next().value!);
    }
    this.keep(key, { value, chars, expires: Date.now() + ttlSeconds * 1000 });
  }

  private keep(key: string, entry: { value: unknown; chars: number; expires: number }): void {
    this.store.set(key, entry);
    this.chars += entry.chars;
  }

  private drop(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    this.store.delete(key);
    this.chars -= entry.chars;
  }
}
