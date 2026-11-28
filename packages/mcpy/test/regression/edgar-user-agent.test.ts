/**
 * Regression: SEC answers 403 to a User-Agent that links to github.com, and
 * mcpy's default profile does (verified 2026-11-28 from a Worker and from a
 * laptop). Sent with it, every stock_fundamentals call failed with
 * upstream_failed. The EDGAR source now sends its own default, which SEC
 * accepts and which names no deployment, or the one it is given.
 */

import { describe, expect, it } from "vitest";
import { edgar, EDGAR_USER_AGENT } from "../../src/providers/edgar/index.js";
import { fixture, stubFetch } from "../helpers.js";
import { json, providerCall } from "../contract/call.js";

const SEC_UA = "mcpy/1.0 (+https://tools.example.com)";

describe("EDGAR's user agent", () => {
  it("defaults to its own, never mcpy's default profile, and names no deployment", async () => {
    const { fetch, calls } = stubFetch(() => json(fixture("stocks/edgar-tickers.json")));
    await edgar().directory!(providerCall(fetch));
    expect(calls[0]!.headers.get("user-agent")).toBe(EDGAR_USER_AGENT);
    expect(EDGAR_USER_AGENT).not.toMatch(/github\.com/);
  });

  it("is the one it was given, on the ticker list and on every filing request", async () => {
    const { fetch, calls } = stubFetch((url) => (url.includes("company_tickers") ? json(fixture("stocks/edgar-tickers.json")) : json(fixture("stocks/edgar-aapl-assets.json"))));
    const sec = edgar({ userAgent: SEC_UA });
    await sec.directory!(providerCall(fetch));
    await sec.fundamentals!("AAPL", "0000320193", providerCall(fetch));
    expect(calls.length).toBeGreaterThan(2);
    expect(new Set(calls.map((c) => c.headers.get("user-agent")))).toEqual(new Set([SEC_UA]));
  });
});
