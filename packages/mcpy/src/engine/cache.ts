/** Cache abstraction so storage can change (KV, Redis, memory) without touching operations. */

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

/** The subset of a Cloudflare KV namespace this cache needs. */
export interface KvLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

// KV values are capped at 25 MiB; stay well under it.
const KV_MAX_VALUE_BYTES = 20 * 1024 * 1024;
// KV rejects expirationTtl below 60 seconds.
const KV_MIN_TTL = 60;

export class KvCache implements Cache {
  constructor(private readonly kv: KvLike) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      return ((await this.kv.get(key, "json")) as T | null) ?? null;
    } catch {
      return null; // a cache read must never fail a request
    }
  }

  async put<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const body = JSON.stringify(value);
    if (body.length > KV_MAX_VALUE_BYTES) return;
    try {
      await this.kv.put(key, body, { expirationTtl: Math.max(KV_MIN_TTL, ttlSeconds) });
    } catch {
      // Best effort: KV write limits (1 write/sec/key) must not fail requests.
    }
  }
}

export class NoCache implements Cache {
  async get<T>(): Promise<T | null> {
    return null;
  }
  async put(): Promise<void> {}
}

/** In-process LRU-ish cache for Node/Bun use and tests. */
export class MemoryCache implements Cache {
  private readonly store = new Map<string, { value: unknown; expires: number }>();
  constructor(private readonly maxEntries = 1000) {}

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }

  async put<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
}
