/**
 * The stock routes over REST, against a network where every upstream answers
 * 404: Yahoo's "no such symbol". GET query strings carry the symbol list and
 * the numeric `years`.
 */

import { ErrorBodySchema, ErrorCode, RestRoute, StockQuoteResultSchema } from "mcpy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, makeEnv, stubNetwork } from "./harness.js";

let network: ReturnType<typeof stubNetwork>;
beforeEach(() => {
  network = stubNetwork();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /v1/stocks/*", () => {
  it("quotes a comma-separated symbol list; symbols no source knows come back as missing", async () => {
    const res = await call(`${RestRoute.StockQuote}?symbols=AAPL,BRK-B`, { env: makeEnv() });
    expect(res.status).toBe(200);
    const body = StockQuoteResultSchema.parse(await res.json());
    expect(body).toMatchObject({ quotes: [], missing: ["AAPL", "BRK-B"] });
    expect(network.upstream.some((u) => u.includes("/v8/finance/chart/AAPL"))).toBe(true);
  });

  it("reads years as a number, and refuses a window longer than its interval allows", async () => {
    const years = await call(`${RestRoute.StockFundamentals}?symbol=AAPL&years=3`, { env: makeEnv() });
    expect(ErrorBodySchema.parse(await years.json()).error.code).not.toBe(ErrorCode.InvalidInput);
    const long = await call(`${RestRoute.StockHistory}?symbol=AAPL&from=2010-01-01&to=2020-01-01`, { env: makeEnv() });
    expect(long.status).toBe(400);
    expect(JSON.stringify(ErrorBodySchema.parse(await long.json()).error.details)).toMatch(/interval week or month/);
  });
});
