/**
 * Regressions for the security findings of the Fable review (2026-10-22).
 * Numbers match the review. Never delete one.
 */

import { describe, expect, it } from "vitest";
import { ErrorCode, GrepMode, McpyError, PageFormat, UserAgentProfile } from "mcpy";
import { direct, HttpClient, HttpMethod } from "mcpy/providers";
import { Telemetry } from "mcpy/telemetry";
import { grepLines } from "../../src/content/text.js";
import { isRetryableError } from "../../src/http/retry.js";
import { USER_AGENTS } from "../../src/http/user-agents.js";
import { fakePages, page, responseAt, stubFetch, testMcpy } from "../helpers.js";

const html = (body: string) => responseAt("https://x", `<html><head><title>T</title></head><body><article>${body}</article></body></html>`, {
  headers: { "content-type": "text/html" },
});

function call(fetch: typeof globalThis.fetch) {
  return {
    http: new HttpClient({ fetch, retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 2 } }),
    context: { signal: new AbortController().signal, deadlineAt: Date.now() + 10_000, maxBytes: 1_000_000, telemetry: Telemetry.noop() },
    userAgent: (p: UserAgentProfile) => USER_AGENTS[p],
    timeoutMs: 5_000,
  };
}

describe("#1 grep cannot be stalled by a pathological pattern", () => {
  it("runs a catastrophic-backtracking pattern in linear time", () => {
    const t = performance.now();
    const r = grepLines([`${"a".repeat(50_000)}!`], "(a+)+$", 0, 5);
    expect(performance.now() - t).toBeLessThan(500);
    expect(r.matches).toBe(0);
  });

  it("rejects syntax RE2 cannot run in linear time as invalid_input", () => {
    for (const pattern of ["(?=x)", "(a)\\1", "(?<!x)y"]) {
      expect(() => grepLines(["x"], pattern, 0, 5), pattern).toThrow(expect.objectContaining({ code: ErrorCode.InvalidInput }));
    }
  });

  it("literal mode treats regex metacharacters as text", async () => {
    const content = `price is $5.00 (approx)\n${"filler line\n".repeat(30)}`;
    const { mcpy } = testMcpy({ pages: [fakePages("p", page({ content }))] });
    const r = await mcpy.grep({ url: "https://example.com/a", pattern: "$5.00 (approx", mode: GrepMode.Literal });
    expect(r.matches).toBe(1);
  });
});

describe("#2 redirects cannot reach private addresses", () => {
  it("refuses a public URL that redirects to loopback, without paying for a fallback", async () => {
    const { fetch } = stubFetch((url) =>
      url.startsWith("https://public.example") ? responseAt(url, null, { status: 302, headers: { location: "http://127.0.0.1:8080/admin" } }) : html("secret"),
    );
    const paid = fakePages("paid", page(), 0.01);
    const { mcpy } = testMcpy({ pages: [direct(), paid], fetch });
    const err = await mcpy.fetch({ url: "https://public.example/r" }).catch((e) => e);
    expect(err).toBeInstanceOf(McpyError);
    expect(err.code).toBe(ErrorCode.InvalidTarget);
    expect(paid.calls).toHaveLength(0);
  });

  it("checks every hop, including relative and metadata-endpoint locations", async () => {
    for (const location of ["http://169.254.169.254/latest/meta-data", "http://[::ffff:7f00:1]/", "//localhost./x"]) {
      const { fetch, calls } = stubFetch((url) => (calls.length === 1 ? responseAt(url, null, { status: 301, headers: { location } }) : html("x")));
      const err = await direct().fetchPage({ url: "https://a.example/", format: PageFormat.Markdown, userAgent: UserAgentProfile.Mcpy }, call(fetch)).catch((e) => e);
      expect(err.code, location).toBe(ErrorCode.InvalidTarget);
      expect(calls, location).toHaveLength(1);
    }
  });

  it("stops after too many redirects", async () => {
    const { fetch } = stubFetch((url, n) => responseAt(url, null, { status: 302, headers: { location: `https://a.example/${n}` } }));
    const err = await call(fetch).http.send({ url: "https://a.example/0" }, call(fetch).context).catch((e) => e);
    expect(err.code).toBe(ErrorCode.UpstreamFailed);
    expect(err.message).toMatch(/redirects/);
  });

  it("turns a POST into a GET on 303, as browsers do", async () => {
    const { fetch, calls } = stubFetch((url, n) => (n === 1 ? responseAt(url, null, { status: 303, headers: { location: "/done" } }) : responseAt(url, "ok")));
    await call(fetch).http.send({ url: "https://a.example/form", method: HttpMethod.Post, json: { a: 1 } }, call(fetch).context);
    expect(calls[1]).toMatchObject({ url: "https://a.example/done", method: HttpMethod.Get, body: undefined });
  });
});

describe("#7 binary content is refused before download and never escalated", () => {
  it("does not read a PDF body and does not call paid providers", async () => {
    let read = false;
    // highWaterMark 0: pull runs only when someone actually reads the body.
    const body = new ReadableStream(
      {
        pull() {
          read = true;
          throw new Error("body must not be read");
        },
      },
      { highWaterMark: 0 },
    );
    const { fetch } = stubFetch((url) => responseAt(url, body, { headers: { "content-type": "application/pdf" } }));
    const paid = fakePages("paid", page(), 0.01);
    const { mcpy } = testMcpy({ pages: [direct(), paid], fetch });
    const err = await mcpy.fetch({ url: "https://example.com/doc.pdf" }).catch((e) => e);
    expect(err.code).toBe(ErrorCode.UnsupportedContent);
    expect(read).toBe(false);
    expect(paid.calls).toHaveLength(0);
  });
});

describe("#8 internal error text never reaches callers", () => {
  it("returns a fixed message for a malformed provider result", async () => {
    // Passes the provider contract but fails output validation (status must be an integer).
    const broken = fakePages("p", page({ status: 200.5 }));
    const { mcpy, sink } = testMcpy({ pages: [broken] });
    const err = (await mcpy.fetch({ url: "https://example.com/a" }).catch((e) => e)) as McpyError;
    expect(err.code).toBe(ErrorCode.Internal);
    expect(err.message).toBe("internal error");
    expect(err.toJSON()).toEqual({ error: { code: ErrorCode.Internal, message: "internal error" } });
    // The detail is kept for operators.
    expect(sink.logs.some((l) => /expected|int/i.test(String(l.attributes["mcpy.reason"])))).toBe(true);
  });
});

describe("#13 only network failures are retried", () => {
  it("does not retry programming errors that happen to be TypeErrors", () => {
    expect(isRetryableError(new TypeError("Invalid header value"))).toBe(false);
    expect(isRetryableError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isRetryableError(new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNRESET" }) }))).toBe(true);
    expect(isRetryableError(new Error("Network connection lost."))).toBe(true);
  });
});
