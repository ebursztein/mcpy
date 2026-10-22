import { loadConfig, type Env } from "../src/config";
import type { FetchedPage, FetchProvider, ProviderDeps } from "../src/providers/types";

export const LONG_TEXT = "Lorem ipsum dolor sit amet. ".repeat(20);

export function page(overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    url: "https://example.com/a",
    finalUrl: "https://example.com/a",
    status: 200,
    contentType: "text/markdown",
    content: LONG_TEXT,
    format: "markdown",
    ...overrides,
  };
}

/** A fake provider that returns (or throws) a scripted result and counts calls. */
export function fakeFetcher(id: string, result: FetchedPage | Error, cost = 0): FetchProvider & { calls: number } {
  const p = {
    id,
    costPerCall: cost,
    calls: 0,
    async fetch() {
      p.calls++;
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return p;
}

export interface Recorded {
  url: string;
  init?: RequestInit;
  body?: unknown;
}

/** Stub fetch that records requests and replies from a handler. */
export function stubFetch(reply: (url: string, init?: RequestInit) => Response): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return reply(url, init);
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function deps(env: Env, f: typeof fetch): ProviderDeps {
  return { env, config: loadConfig(env), fetch: f };
}
