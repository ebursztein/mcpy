/** Shared test doubles. Tests import the SDK through the `mcpy` aliases. */

import { readFileSync } from "node:fs";
import { ContentKind, createMcpy, LayeredCache, PageFormat, SearchType, type KvLike, type McpyOptions } from "mcpy";
import type { FetchedPage, FoundPage, PageProvider, PageRequest, SearchCapabilities, SearchProvider, SearchRequest } from "mcpy/providers";
import { MemorySink, Telemetry } from "mcpy/telemetry";

export const LONG_TEXT = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20);

export function page(overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    url: "https://example.com/a",
    finalUrl: "https://example.com/a",
    status: 200,
    contentType: "text/markdown",
    kind: ContentKind.Html,
    content: LONG_TEXT,
    format: PageFormat.Markdown,
    ...overrides,
  };
}

type Script<T> = T | Error | ((req: PageRequest) => T | Promise<T>);

/** A scripted page provider that counts calls and records requests. */
export function fakePages(id: string, script: Script<FetchedPage>, costPerCall = 0): PageProvider & { calls: PageRequest[] } {
  const calls: PageRequest[] = [];
  return {
    id,
    costPerCall,
    calls,
    async fetchPage(req) {
      calls.push(req);
      if (script instanceof Error) throw script;
      return typeof script === "function" ? script(req) : script;
    },
  };
}

/** A provider that can do everything, unless a test narrows it. */
export const ALL_SEARCH: SearchCapabilities = {
  types: Object.values(SearchType),
  recency: true,
  sites: true,
  country: true,
  language: true,
  device: true,
  maxDepth: 1_000,
};

export function fakeSearch(
  id: string,
  script: FoundPage[] | Error,
  costPerCall = 0,
  capabilities: SearchCapabilities = ALL_SEARCH,
): SearchProvider & { calls: number; requests: SearchRequest[] } {
  const p = {
    id,
    costPerCall,
    capabilities,
    calls: 0,
    requests: [] as SearchRequest[],
    async search(req: SearchRequest) {
      p.calls++;
      p.requests.push(req);
      if (script instanceof Error) throw script;
      return script;
    },
  };
  return p;
}

export interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/**
 * Stub fetch: records every request and answers from `reply`, which may
 * return a Response or throw (to simulate network errors).
 */
export function stubFetch(reply: (url: string, call: number, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === "string" ? safeJson(init.body) : undefined;
    calls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body });
    return reply(url, calls.length, init);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** A Response whose `url` is set, as real fetch responses have. */
export function responseAt(url: string, body: BodyInit | null, init: ResponseInit = {}): Response {
  const res = new Response(body, init);
  Object.defineProperty(res, "url", { value: url });
  return res;
}

/** createMcpy with a memory sink attached and fast retries. */
export function testMcpy(options: McpyOptions = {}) {
  const sink = new MemorySink();
  const telemetry = new Telemetry([sink], {}, "debug");
  const mcpy = createMcpy({
    cache: new LayeredCache(),
    retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5 },
    ...options,
    telemetry: options.telemetry ?? telemetry,
  });
  return { mcpy, sink };
}

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export function fixtureJson<T = unknown>(name: string): T {
  return JSON.parse(fixture(name)) as T;
}

export const PROVIDER_IDS = ["direct", "cloudflare_browser", "firecrawl", "brightdata", "serpent"];

/** True when serialized output mentions any built-in provider id. */
export function mentionsProvider(value: unknown): boolean {
  const text = JSON.stringify(value);
  // Whole words: "redirected" is not the direct provider.
  return PROVIDER_IDS.some((id) => new RegExp(`(^|[^a-z_])${id}([^a-z_]|$)`, "i").test(text));
}

/**
 * A KV namespace in memory, recording what reaches it: each bulk get's keys
 * and each written key. `keep(key, exists)` can refuse a write (to model a
 * lagging edge or a lost write); `failing` makes every call throw "kv down".
 * Use it as `new LayeredCache({ kv, memory: false })` to test KV itself.
 */
export function fakeKv(options: { keep?: (key: string, exists: boolean) => boolean; failing?: boolean } = {}) {
  const data = new Map<string, string>();
  const bulkGets: string[][] = [];
  const puts: string[] = [];
  const down = () => Promise.reject(new Error("kv down"));
  const kv = {
    data,
    bulkGets,
    puts,
    get(keys: string[] | string, type: "json" | "text"): Promise<never> {
      if (options.failing) return down();
      const one = (k: string) => (!data.has(k) ? null : type === "json" ? JSON.parse(data.get(k)!) : data.get(k)!);
      if (typeof keys === "string") return Promise.resolve(one(keys) as never);
      bulkGets.push([...keys]);
      return Promise.resolve(new Map(keys.map((k) => [k, one(k)])) as never);
    },
    async put(key: string, value: string): Promise<void> {
      if (options.failing) return down();
      puts.push(key);
      if (options.keep && !options.keep(key, data.has(key))) return;
      data.set(key, value);
    },
  };
  return kv satisfies KvLike;
}
