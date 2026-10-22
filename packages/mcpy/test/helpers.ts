/** Shared test doubles. Tests import the SDK through the `mcpy` aliases. */

import { readFileSync } from "node:fs";
import { ContentKind, createMcpy, MemoryCache, PageFormat, SearchType, type McpyOptions } from "mcpy";
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
    cache: new MemoryCache(),
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

export const PROVIDER_IDS = ["direct", "cloudflare_browser", "firecrawl", "brightdata"];

/** True when serialized output mentions any built-in provider id. */
export function mentionsProvider(value: unknown): boolean {
  const text = JSON.stringify(value);
  return PROVIDER_IDS.some((id) => text.includes(id));
}
