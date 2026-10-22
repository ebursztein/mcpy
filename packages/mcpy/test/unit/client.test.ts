import { describe, expect, it } from "vitest";
import { CacheStatus, ErrorCode, McpyError, PageFormat, RestRoute, UserAgentProfile, type FetchResult, type GrepResult, type SearchResult } from "mcpy";
import { McpyClient } from "mcpy/client";
import { stubFetch } from "../helpers.js";

const BASE = "https://tools.example.com";
const KEY = "mcpy-test-key";
const meta = { cache: CacheStatus.Miss, latency_ms: 120, attempts: 1 };

const fetchResult: FetchResult = {
  url: "https://example.com/a",
  final_url: "https://www.example.com/a",
  title: "A",
  status: 200,
  format: PageFormat.Markdown,
  content: "# A",
  start_index: 0,
  end_index: 3,
  total_length: 3,
  truncated: false,
  meta,
};
const grepResult: GrepResult = { url: "https://example.com/a", final_url: "https://example.com/a", matches: 1, capped: false, total_lines: 10, output: "3: hit", truncated: false, meta };
const searchResult: SearchResult = { query: "q", results: [{ title: "T", url: "https://example.com/t", snippet: "s" }], meta };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const client = (fetch: typeof globalThis.fetch, extra: { timeoutMs?: number; baseUrl?: string } = {}) => new McpyClient({ baseUrl: BASE, apiKey: KEY, fetch, ...extra });

async function errorOf(promise: Promise<unknown>): Promise<McpyError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof McpyError)) throw new Error(`expected McpyError, got ${String(err)}`);
  return err;
}

describe("McpyClient requests", () => {
  it("posts fetch to its route with Bearer auth and the validated body (defaults applied)", async () => {
    const { fetch, calls } = stubFetch(() => json(fetchResult));
    const out = await client(fetch).fetch({ url: "https://example.com/a", user_agent: UserAgentProfile.ChromeDesktop });
    expect(out).toEqual(fetchResult);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}${RestRoute.Fetch}`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].body).toEqual({
      url: "https://example.com/a",
      format: PageFormat.Markdown,
      start_index: 0,
      max_length: 10_000,
      user_agent: UserAgentProfile.ChromeDesktop,
      fresh: false,
    });
  });

  it("posts grep and search to their routes", async () => {
    const { fetch, calls } = stubFetch((url) => json(url.endsWith(RestRoute.Grep) ? grepResult : searchResult));
    const c = client(fetch);
    expect(await c.grep({ url: "https://example.com/a", pattern: "hit" })).toEqual(grepResult);
    expect(await c.search({ query: "  q  ", limit: 3 })).toEqual(searchResult);
    expect(calls.map((x) => x.url)).toEqual([`${BASE}${RestRoute.Grep}`, `${BASE}${RestRoute.Search}`]);
    expect(calls[0].body).toEqual({ url: "https://example.com/a", pattern: "hit", mode: "regex", context_lines: 3, max_matches: 20, format: PageFormat.Markdown, fresh: false });
    expect(calls[1].body).toEqual({ query: "q", limit: 3, fresh: false });
  });

  it("strips a trailing slash from the base URL", async () => {
    const { fetch, calls } = stubFetch(() => json(searchResult));
    await client(fetch, { baseUrl: `${BASE}/` }).search({ query: "q" });
    expect(calls[0].url).toBe(`${BASE}${RestRoute.Search}`);
  });

  it("strips unknown fields from the result", async () => {
    const { fetch } = stubFetch(() => json({ ...searchResult, provider: "secret" }));
    expect(await client(fetch).search({ query: "q" })).not.toHaveProperty("provider");
  });
});

describe("McpyClient local validation", () => {
  it.each([
    ["fetch", (c: McpyClient) => c.fetch({ url: "not a url" })],
    ["fetch max_length", (c: McpyClient) => c.fetch({ url: "https://example.com", max_length: 5 })],
    ["grep", (c: McpyClient) => c.grep({ url: "https://example.com", pattern: "" })],
    ["search", (c: McpyClient) => c.search({ query: "   " })],
  ])("rejects invalid %s input without a request", async (_name, call) => {
    const { fetch, calls } = stubFetch(() => json({}));
    const err = await errorOf(call(client(fetch)));
    expect(err.code).toBe(ErrorCode.InvalidInput);
    expect(err.details?.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it("names the offending field in details", async () => {
    const { fetch } = stubFetch(() => json({}));
    const err = await errorOf(client(fetch).fetch({ url: "https://example.com", start_index: -1 }));
    expect(err.details?.[0]).toMatch(/^start_index: /);
  });
});

describe("McpyClient errors", () => {
  it.each([
    [400, ErrorCode.InvalidInput, ["url: Invalid URL"]],
    [401, ErrorCode.Unauthorized, undefined],
    [429, ErrorCode.RateLimited, undefined],
    [502, ErrorCode.UpstreamFailed, ["error (timed out)", "escalate (blocked)"]],
  ])("rebuilds the server's McpyError from an HTTP %i error body", async (status, code, details) => {
    const body = new McpyError(code, `server says ${code}`, details).toJSON();
    const { fetch } = stubFetch(() => json(body, status));
    const err = await errorOf(client(fetch).fetch({ url: "https://example.com/a" }));
    expect(err).toBeInstanceOf(McpyError);
    expect(err.code).toBe(code);
    expect(err.message).toBe(`server says ${code}`);
    expect(err.details).toEqual(details);
    expect(err.toJSON()).toEqual(body);
  });

  it("maps a non-JSON error body to bad_response naming the status", async () => {
    const { fetch } = stubFetch(() => new Response("<html>Bad Gateway</html>", { status: 502 }));
    const err = await errorOf(client(fetch).search({ query: "q" }));
    expect(err.code).toBe(ErrorCode.BadResponse);
    expect(err.message).toContain("502");
  });

  it("maps an error body with an unknown code to bad_response", async () => {
    const { fetch } = stubFetch(() => json({ error: { code: "teapot", message: "no" } }, 418));
    expect((await errorOf(client(fetch).search({ query: "q" }))).code).toBe(ErrorCode.BadResponse);
  });

  it.each([
    ["non-JSON", () => new Response("OK", { status: 200 })],
    ["wrong shape", () => json({ query: "q", results: "none" })],
    ["empty", () => new Response(null, { status: 200 })],
  ])("maps a %s success body to bad_response", async (_name, reply) => {
    const { fetch } = stubFetch(reply);
    const err = await errorOf(client(fetch).search({ query: "q" }));
    expect(err.code).toBe(ErrorCode.BadResponse);
  });

  it("maps a network failure to upstream_failed", async () => {
    const { fetch } = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await errorOf(client(fetch).fetch({ url: "https://example.com/a" }));
    expect(err.code).toBe(ErrorCode.UpstreamFailed);
  });

  it("maps the client-side timeout to timeout", async () => {
    const { fetch } = stubFetch(
      (_url, _n, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const err = await errorOf(client(fetch, { timeoutMs: 20 }).fetch({ url: "https://example.com/a" }));
    expect(err.code).toBe(ErrorCode.Timeout);
  });

  // Regression (fixed): client.ts:84 swallows body-read failures (`res.json().catch(() => undefined)`), so when the
  // timeout fires while the body is still streaming (real fetch errors the stream with the TimeoutError),
  // the caller gets bad_response instead of timeout. Fix: let TimeoutError/AbortError from the body
  // read map to ErrorCode.Timeout like the fetch() call does.
  it("maps a timeout while reading the body to timeout", async () => {
    const { fetch } = stubFetch((_url, _n, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"query":'));
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const err = await errorOf(client(fetch, { timeoutMs: 20 }).search({ query: "q" }));
    expect(err.code).toBe(ErrorCode.Timeout);
  });
});
