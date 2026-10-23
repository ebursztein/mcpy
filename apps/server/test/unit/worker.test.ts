import { CacheStatus, ErrorBodySchema, LogLevel, ErrorCode, FetchResultSchema, GrepResultSchema, RestRoute } from "mcpy";
import { ProviderId } from "mcpy/providers";
import { Attr } from "mcpy/telemetry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mentionsProvider } from "../../../../packages/mcpy/test/helpers.js";
import { SkipReason } from "../../src/providers.js";
import { AdminRoute } from "../../src/rest.js";
import { ADMIN_KEY, ARTICLE_TITLE, articleUrl, call, captureLogs, makeEnv, stubNetwork, USER_KEY } from "./harness.js";

let net: ReturnType<typeof stubNetwork>;
beforeEach(() => {
  net = stubNetwork();
  vi.spyOn(console, "log").mockImplementation(() => undefined); // keep JSON log lines out of the test output
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function errorOf(response: Response) {
  return ErrorBodySchema.parse(await response.json()).error;
}

describe("routing", () => {
  it("serves /health without auth", async () => {
    const response = await call("/health", { key: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, name: "mcpy" });
  });

  it("404s an unknown path with an ErrorBody, before auth", async () => {
    const response = await call("/nope", { key: null });
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe(ErrorCode.NotFound);
  });

  it("404s an unknown /v1 route for an authenticated client", async () => {
    const response = await call("/v1/nope");
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe(ErrorCode.NotFound);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("answers 405 with Allow for other methods", async () => {
    const response = await call(RestRoute.Fetch, { method: "PUT" });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, POST");
    expect((await errorOf(response)).code).toBe(ErrorCode.InvalidInput);
  });
});

describe("authentication", () => {
  it.each([
    ["no key", null],
    ["a wrong key", "w".repeat(30)],
  ])("rejects %s with 401 and WWW-Authenticate", async (_label, key) => {
    const response = await call(`${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl())}`, { key });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect((await errorOf(response)).code).toBe(ErrorCode.Unauthorized);
    expect(net.upstream).toEqual([]);
  });

  it("rejects everyone when no clients are configured", async () => {
    const response = await call(`${RestRoute.Fetch}?url=x`, { env: makeEnv({ MCPY_CLIENTS: "" }) });
    expect(response.status).toBe(401);
  });

  it.each([
    ["Bearer", { headers: { Authorization: `Bearer ${USER_KEY}` } }, ""],
    ["X-API-Key", { headers: { "X-API-Key": USER_KEY } }, ""],
    ["?key=", {}, `&key=${USER_KEY}`],
  ])("accepts the key via %s", async (_label, extra, suffix) => {
    const response = await call(`${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl())}${suffix}`, { key: null, ...extra });
    expect(response.status).toBe(200);
    expect(FetchResultSchema.parse(await response.json()).title).toBe(ARTICLE_TITLE);
  });

  it("does not forward the URL key upstream", async () => {
    await call(`${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl())}&key=${USER_KEY}`, { key: null });
    expect(net.upstream.join(" ")).not.toContain(USER_KEY);
  });
});

describe("request ids", () => {
  // Regression (Fable): a client-supplied cf-ray must not choose the request id.
  it("never takes the request id from a client-supplied cf-ray header", async () => {
    const response = await call(`${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl())}`, { headers: { "cf-ray": "8abc123-SJC" } });
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("generates one otherwise", async () => {
    const response = await call(`${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl())}`);
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("REST operations", () => {
  it("POST /v1/fetch returns a FetchResult with no provider ids", async () => {
    const url = articleUrl("post");
    const response = await call(RestRoute.Fetch, { body: { url } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body: unknown = await response.json();
    const result = FetchResultSchema.parse(body);
    expect(result.url).toBe(url);
    expect(result.title).toBe(ARTICLE_TITLE);
    expect(result.content).toContain("salt winds");
    expect(result.meta.cache).toBe(CacheStatus.Miss);
    expect(mentionsProvider(body)).toBe(false);
  });

  it("serves a repeat from cache", async () => {
    const env = makeEnv();
    const url = articleUrl("repeat");
    await call(RestRoute.Fetch, { body: { url }, env });
    const again = FetchResultSchema.parse(await (await call(RestRoute.Fetch, { body: { url }, env })).json());
    expect(again.meta.cache).toBe(CacheStatus.Hit);
    expect(again.meta.attempts).toBe(0);
    expect(net.upstream.filter((u) => u === url)).toHaveLength(1);
  });

  it("GET /v1/fetch coerces numeric and boolean query fields", async () => {
    const env = makeEnv();
    const url = articleUrl("get");
    await call(`${RestRoute.Fetch}?url=${encodeURIComponent(url)}`, { env });
    const response = await call(`${RestRoute.Fetch}?url=${encodeURIComponent(url)}&max_chars=150&offset=10&fresh=true`, { env });
    expect(response.status).toBe(200);
    const result = FetchResultSchema.parse(await response.json());
    expect(result.content.length).toBeLessThanOrEqual(150);
    expect(result.offset).toBe(10);
    expect(result.next_offset).toBe(result.offset + result.content.length);
    expect(result.meta.cache).toBe(CacheStatus.Bypass);
  });

  it("POST /v1/grep returns matching lines", async () => {
    const response = await call(RestRoute.Grep, { body: { url: articleUrl("grep"), pattern: "garden society", context: 0 } });
    expect(response.status).toBe(200);
    const result = GrepResultSchema.parse(await response.json());
    expect(result.matches).toBe(1);
    expect(result.output).toContain("garden society");
  });

  it("GET /v1/grep works with query parameters", async () => {
    const query = `url=${encodeURIComponent(articleUrl("grepget"))}&pattern=${encodeURIComponent("section \\d+")}&max_matches=2`;
    const result = GrepResultSchema.parse(await (await call(`${RestRoute.Grep}?${query}`)).json());
    expect(result.matches).toBe(2);
    expect(result.more_matches).toBe(true);
  });

  it("rejects invalid input with 400 invalid_input and details", async () => {
    const response = await call(RestRoute.Fetch, { body: { url: "not a url", max_chars: 5 } });
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe(ErrorCode.InvalidInput);
    expect(error.details?.some((d) => d.startsWith("url"))).toBe(true);
    expect(error.details?.some((d) => d.startsWith("max_chars"))).toBe(true);
  });

  it.each([["not json"], ["[1,2]"]])("rejects the body %j with 400 invalid_input", async (body) => {
    const response = await call(RestRoute.Fetch, { body });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe(ErrorCode.InvalidInput);
  });

  it.each(["http://127.0.0.1/", "http://localhost:8080/", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"])(
    "rejects the private or non-http target %s with 400 invalid_target",
    async (url) => {
      const response = await call(RestRoute.Fetch, { body: { url } });
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe(ErrorCode.InvalidTarget);
      expect(net.upstream).toEqual([]);
    },
  );

  // Regression: IPv4-mapped IPv6 / unspecified literals used to bypass the private-host guard (url.ts).
  it.each(["http://[::ffff:127.0.0.1]/", "http://[::ffff:a9fe:a9fe]/", "http://[::]/", "http://localhost./", "http://100.64.0.1/"])(
    "rejects the disguised private target %s",
    async (url) => {
      const response = await call(RestRoute.Fetch, { body: { url } });
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe(ErrorCode.InvalidTarget);
      expect(net.upstream).toEqual([]);
    },
  );

  it("returns 503 no_providers for search when no search provider has credentials", async () => {
    const response = await call(`${RestRoute.Search}?query=gardens`);
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe(ErrorCode.NoProviders);
  });
});

describe("admin", () => {
  it("refuses user clients with a forbidden error", async () => {
    const response = await call(AdminRoute.Providers);
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe(ErrorCode.Forbidden);
  });

  it("lists enabled and skipped providers for admin clients", async () => {
    const response = await call(AdminRoute.Providers, { key: ADMIN_KEY });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      pages: [ProviderId.Direct],
      search: [],
      papers: [ProviderId.OpenAlex, ProviderId.Arxiv, ProviderId.PubMed],
      skipped: {
        pages: [],
        search: [{ id: ProviderId.Firecrawl, reason: SkipReason.MissingCredentials }],
        papers: [{ id: ProviderId.SemanticScholar, reason: SkipReason.MissingCredentials }],
      },
    });
  });
});

describe("rate limiting and misconfiguration", () => {
  it("returns 429 rate_limited with Retry-After, keyed by client name", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const response = await call(`${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl())}`, { env: makeEnv({ RATE_LIMITER: { limit } }) });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect((await errorOf(response)).code).toBe(ErrorCode.RateLimited);
    expect(limit).toHaveBeenCalledWith({ key: "alice" });
    expect(net.upstream).toEqual([]);
  });

  it("lets requests through when the limiter allows them", async () => {
    const env = makeEnv({ RATE_LIMITER: { limit: async () => ({ success: true }) } });
    expect((await call(`${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl())}`, { env })).status).toBe(200);
  });

  it("answers 500 internal without leaking config details", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await call(RestRoute.Fetch, { body: { url: articleUrl() }, env: makeEnv({ PAGE_PROVIDERS: "direct,bogus_provider" }) });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(ErrorBodySchema.parse(JSON.parse(text)).error.code).toBe(ErrorCode.Internal);
    expect(text).not.toMatch(/PAGE_PROVIDERS|bogus_provider/);
    expect(String(errors.mock.calls[0]?.[0])).toContain("PAGE_PROVIDERS");
  });

  it("answers 500 when MCPY_CLIENTS is malformed, without echoing it", async () => {
    const response = await call(RestRoute.Fetch, { body: { url: articleUrl() }, env: makeEnv({ MCPY_CLIENTS: "Bad Name:short" }) });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("short");
  });
});

describe("structured logs", () => {
  it("tags every JSON log line of an authenticated request with client.name and mcpy.request.id", async () => {
    const env = makeEnv({ LOG_LEVEL: LogLevel.Debug });
    const { value: response, lines } = await captureLogs(() =>
      call(RestRoute.Fetch, { body: { url: articleUrl("logs") }, env, headers: { "cf-ray": "ray-logs-1" } }),
    );
    expect(response.status).toBe(200);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(line[Attr.ClientName], JSON.stringify(line)).toBe("alice");
      expect(line[Attr.RequestId], JSON.stringify(line)).toBe(response.headers.get("X-Request-Id"));
      expect(line[Attr.CfRay], JSON.stringify(line)).toBe("ray-logs-1");
    }
    expect(lines.some((l) => l.message === "fetch ok")).toBe(true);
  });

  it("tags failed operations and rate-limit warnings too", async () => {
    const env = makeEnv({ RATE_LIMITER: { limit: async () => ({ success: false }) } });
    const { lines } = await captureLogs(() => call(RestRoute.Fetch, { body: { url: articleUrl() }, env }));
    const warn = lines.find((l) => l.message === "rate limited");
    expect(warn?.[Attr.ClientName]).toBe("alice");
    expect(warn?.[Attr.RequestId]).toBeTruthy();
    const { lines: failed } = await captureLogs(() => call(RestRoute.Fetch, { body: { url: "http://127.0.0.1/" } }));
    expect(failed.find((l) => l.message === "fetch failed")).toMatchObject({ [Attr.ClientName]: "alice" });
  });
});
