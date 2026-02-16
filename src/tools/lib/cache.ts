interface CacheEntry {
  content: string;
  fetchedAt: number;
}

export class TtlCache {
  private store = new Map<string, CacheEntry>();
  private ttl: number;
  private maxSize: number;

  constructor(ttlMs: number = 15 * 60 * 1000, maxSize: number = 100) {
    this.ttl = ttlMs;
    this.maxSize = maxSize;
  }

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > this.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.content;
  }

  set(key: string, content: string): void {
    if (this.store.size >= this.maxSize) {
      const oldest = [...this.store.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
      if (oldest) this.store.delete(oldest[0]);
    }
    this.store.set(key, { content, fetchedAt: Date.now() });
  }
}
