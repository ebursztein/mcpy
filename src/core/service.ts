import type { Config } from "../config";
import { assertPublicHttpUrl, normalizeUrl, sha256Hex } from "../lib/http";
import type { Resolved } from "../providers/registry";
import type { FetchedPage, FetchProvider, PageFormat, SearchHit, SearchProvider } from "../providers/types";
import type { Cache } from "./cache";
import { fetchWithFallback, searchWithFallback, type Attempt } from "./chain";
import type { Telemetry } from "./telemetry";

const CACHE_VERSION = "v1";

export interface Served<T> {
  value: T;
  provider: string;
  cached: boolean;
  attempts: Attempt[];
}

export interface FetchOptions {
  format: PageFormat;
  provider?: string; // force a single provider, bypassing the chain
  fresh?: boolean; // skip the cache read (still writes)
}

export interface SearchOptions {
  limit: number;
  provider?: string;
  fresh?: boolean;
}

/**
 * The single entry point tools use: validation, cache, provider chain and
 * telemetry. Tools never see providers directly.
 */
export class WebService {
  constructor(
    private readonly config: Config,
    private readonly fetchers: Resolved<FetchProvider>,
    private readonly searchers: Resolved<SearchProvider>,
    private readonly cache: Cache,
    private readonly telemetry: Telemetry,
  ) {}

  providers() {
    return {
      fetch: { chain: this.fetchers.chain.map((p) => p.id), skipped: this.fetchers.skipped },
      search: { chain: this.searchers.chain.map((p) => p.id), skipped: this.searchers.skipped },
    };
  }

  async fetchPage(tool: string, rawUrl: string, opts: FetchOptions): Promise<Served<FetchedPage>> {
    const url = assertPublicHttpUrl(rawUrl).toString();
    const chain = pick(this.fetchers.chain, opts.provider);
    const target = new URL(url).hostname;
    const key = `${CACHE_VERSION}:fetch:${opts.format}:${await sha256Hex(normalizeUrl(url))}`;

    // The chain only returns usable or definitive (404/410) pages, so whatever
    // comes back is safe to cache; blocked and challenge pages never are.
    return this.served(tool, target, key, this.config.cacheTtlSeconds, opts.fresh, () =>
      fetchWithFallback(chain, { url, format: opts.format, timeoutMs: this.config.fetchTimeoutMs }, { tool, target, telemetry: this.telemetry }),
    );
  }

  async search(tool: string, query: string, opts: SearchOptions): Promise<Served<SearchHit[]>> {
    const q = query.trim();
    if (!q) throw new Error("query must not be empty");
    const chain = pick(this.searchers.chain, opts.provider);
    const digest = await sha256Hex(`${q.toLowerCase()}\n${opts.limit}`);
    const key = `${CACHE_VERSION}:search:${digest}`;

    return this.served(tool, digest.slice(0, 16), key, this.config.searchCacheTtlSeconds, opts.fresh, () =>
      searchWithFallback(chain, { query: q, limit: opts.limit, timeoutMs: this.config.fetchTimeoutMs }, { tool, target: digest.slice(0, 16), telemetry: this.telemetry }),
    );
  }

  private async served<T>(
    tool: string,
    target: string,
    key: string,
    ttl: number,
    fresh: boolean | undefined,
    run: () => Promise<{ value: T; provider: string; attempts: Attempt[]; costUsd: number }>,
  ): Promise<Served<T>> {
    const started = Date.now();
    if (!fresh) {
      const hit = await this.cache.get<{ value: T; provider: string }>(key);
      if (hit) {
        this.telemetry.record({ event: "call", tool, provider: "cache", outcome: "hit", target, latencyMs: Date.now() - started });
        return { value: hit.value, provider: hit.provider, cached: true, attempts: [] };
      }
    }
    try {
      const r = await run();
      await this.cache.put(key, { value: r.value, provider: r.provider }, ttl);
      this.telemetry.record({ event: "call", tool, provider: r.provider, outcome: "ok", target, latencyMs: Date.now() - started, costUsd: r.costUsd });
      return { value: r.value, provider: r.provider, cached: false, attempts: r.attempts };
    } catch (err) {
      this.telemetry.record({
        event: "call",
        tool,
        provider: "",
        outcome: "error",
        target,
        reason: err instanceof Error ? err.message.slice(0, 200) : String(err),
        latencyMs: Date.now() - started,
      });
      throw err;
    }
  }
}

function pick<P extends { id: string }>(chain: P[], id?: string): P[] {
  if (!id) return chain;
  const p = chain.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" is not enabled (enabled: ${chain.map((x) => x.id).join(", ") || "none"})`);
  return [p];
}
