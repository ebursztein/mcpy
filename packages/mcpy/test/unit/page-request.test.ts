import { describe, expect, it } from "vitest";
import { ErrorCode, HttpMethod, McpyError, PageFormat, UserAgentProfile } from "mcpy";
import type { PageCapabilities, PageProvider, PageRequest } from "mcpy/providers";
import { pageRequestOf, type PageInput } from "../../src/api/page-input.js";
import { capablePageProviders, pageCacheKey } from "../../src/engine/page-request.js";
import { normalizeUrl, sha256Hex } from "../../src/http/url.js";
import { fakePages, page, testMcpy } from "../helpers.js";

const base: PageInput = { url: "https://example.com/api", format: PageFormat.Markdown, render: false, method: HttpMethod.Get };
const plain: PageRequest = { url: "https://example.com/api", format: PageFormat.Markdown, userAgent: UserAgentProfile.Default };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof McpyError ? err.code : "not an McpyError";
  }
  return undefined;
}

/** A page provider with the given capabilities that records what it was asked. */
function able(id: string, capabilities: PageCapabilities, cost = 0) {
  return Object.assign(fakePages(id, page(), cost), { capabilities }) as PageProvider & { calls: PageRequest[] };
}

describe("page request input", () => {
  it("refuses combinations that cannot mean anything", () => {
    expect(codeOf(() => pageRequestOf({ ...base, body: "x" }, UserAgentProfile.Default))).toBe(ErrorCode.InvalidInput);
    expect(codeOf(() => pageRequestOf({ ...base, render: true, method: HttpMethod.Post }, UserAgentProfile.Default))).toBe(ErrorCode.InvalidInput);
    expect(codeOf(() => pageRequestOf({ ...base, wait_ms: 1_000 }, UserAgentProfile.Default))).toBe(ErrorCode.InvalidInput);
  });

  it("refuses headers mcpy owns, repeated names and line breaks", () => {
    const owned: Record<string, string>[] = [{ Host: "evil.example" }, { "Content-Length": "5" }, { Connection: "close" }, { "Transfer-Encoding": "chunked" }];
    for (const headers of owned) {
      expect(codeOf(() => pageRequestOf({ ...base, headers }, UserAgentProfile.Default))).toBe(ErrorCode.InvalidInput);
    }
    expect(codeOf(() => pageRequestOf({ ...base, headers: { origin: "a", Origin: "b" } }, UserAgentProfile.Default))).toBe(ErrorCode.InvalidInput);
    expect(codeOf(() => pageRequestOf({ ...base, headers: { "X-A": "a\r\nX-B: b" } }, UserAgentProfile.Default))).toBe(ErrorCode.InvalidInput);
    expect(codeOf(() => pageRequestOf({ ...base, headers: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`X-${i}`, "v"])) }, UserAgentProfile.Default))).toBe(
      ErrorCode.InvalidInput,
    );
  });

  it("sends a JSON body as JSON unless the caller says otherwise", () => {
    const post = { ...base, method: HttpMethod.Post };
    expect(pageRequestOf({ ...post, body: '{"limit":5}' }, UserAgentProfile.Default).headers).toEqual({ "Content-Type": "application/json" });
    expect(pageRequestOf({ ...post, body: "query=charizard" }, UserAgentProfile.Default).headers).toBeUndefined();
    const typed = pageRequestOf({ ...post, body: "{}", headers: { "content-type": "text/plain" } }, UserAgentProfile.Default);
    expect(typed.headers).toEqual({ "content-type": "text/plain" });
  });

  it("checks the target like any fetch", () => {
    expect(codeOf(() => pageRequestOf({ ...base, url: "http://169.254.169.254/", method: HttpMethod.Post }, UserAgentProfile.Default))).toBe(ErrorCode.InvalidTarget);
  });

  it("leaves a plain GET plain", () => {
    expect(pageRequestOf(base, UserAgentProfile.Chrome)).toEqual({ ...plain, userAgent: UserAgentProfile.Chrome });
  });
});

describe("page routing and cache keys", () => {
  it("keeps the cache key a plain GET always had", async () => {
    expect(await pageCacheKey("v2", plain)).toBe(`v2:page:markdown:default:${await sha256Hex(normalizeUrl(plain.url))}`);
  });

  it("keys every field that changes the answer", async () => {
    const keys = await Promise.all(
      [
        plain,
        { ...plain, render: true },
        { ...plain, render: true, waitMs: 2_000 },
        { ...plain, method: HttpMethod.Post, body: '{"a":1}' },
        { ...plain, method: HttpMethod.Post, body: '{"a":2}' },
        { ...plain, headers: { Origin: "https://a.example" } },
      ].map((r) => pageCacheKey("v2", r)),
    );
    expect(new Set(keys).size).toBe(keys.length);
    // Header names are case-insensitive and unordered.
    expect(await pageCacheKey("v2", { ...plain, headers: { A: "1", b: "2" } })).toBe(await pageCacheKey("v2", { ...plain, headers: { B: "2", a: "1" } }));
  });

  it("sends each request only to providers that can do what it asks", () => {
    const direct = able("direct", { post: true, headers: true });
    const browser = able("browser", { render: true, headers: true });
    const unblocker = able("unblocker", {});
    const all = [direct, browser, unblocker];
    const ids = (r: PageRequest) => capablePageProviders(all, r).map((p) => p.id);
    expect(ids(plain)).toEqual(["direct", "browser", "unblocker"]);
    expect(ids({ ...plain, render: true })).toEqual(["browser"]);
    expect(ids({ ...plain, method: HttpMethod.Post, body: "x" })).toEqual(["direct"]);
    expect(ids({ ...plain, headers: { Origin: "o" } })).toEqual(["direct", "browser"]);
  });

  it("fetch with render skips sources that cannot render, and says so when none can", async () => {
    const direct = able("direct", { post: true, headers: true });
    const browser = able("browser", { render: true });
    const { mcpy } = testMcpy({ pages: [direct, browser] });
    await mcpy.fetch({ url: "https://example.com/app", render: true, wait_ms: 1_500 });
    expect(direct.calls).toHaveLength(0);
    expect(browser.calls[0]).toMatchObject({ render: true, waitMs: 1_500 });

    const { mcpy: noBrowser } = testMcpy({ pages: [able("direct", { post: true })] });
    const err = await noBrowser.fetch({ url: "https://example.com/app", render: true }).then(
      () => undefined,
      (e: McpyError) => e,
    );
    if (!err) throw new Error("expected no_providers");
    expect(err.code).toBe(ErrorCode.NoProviders);
    expect(err.message).toBe("no source on this server can render pages");
  });

  it("fetch with POST hands the body and headers to a source that can send them, and caches by body", async () => {
    const direct = able("direct", { post: true, headers: true });
    const unblocker = able("unblocker", {}, 0.002);
    const { mcpy } = testMcpy({ pages: [direct, unblocker] });
    const ask = (limit: number) =>
      mcpy.fetch({ url: "https://example.com/api", method: HttpMethod.Post, body: JSON.stringify({ limit }), headers: { Origin: "https://example.com" } });
    await ask(5);
    await ask(5);
    await ask(25);
    expect(direct.calls).toHaveLength(2);
    expect(direct.calls[0]).toMatchObject({ method: HttpMethod.Post, body: '{"limit":5}', headers: { Origin: "https://example.com", "Content-Type": "application/json" } });
    expect(unblocker.calls).toHaveLength(0);
  });
});
