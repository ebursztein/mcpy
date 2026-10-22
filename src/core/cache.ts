/** Cache abstraction so storage can change (KV, R2, memory) without touching tools. */

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

// KV values are capped at 25 MiB; stay well under it.
const KV_MAX_VALUE_BYTES = 20 * 1024 * 1024;

export class KvCache implements Cache {
  constructor(private readonly kv: KVNamespace) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      return await this.kv.get<T>(key, "json");
    } catch {
      return null; // a cache read must never fail a request
    }
  }

  async put<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const body = JSON.stringify(value);
    if (body.length > KV_MAX_VALUE_BYTES) return;
    try {
      await this.kv.put(key, body, { expirationTtl: ttlSeconds });
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

export class MemoryCache implements Cache {
  private readonly store = new Map<string, { value: unknown; expires: number }>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit || hit.expires < Date.now()) return null;
    return hit.value as T;
  }

  async put<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
}
