/**
 * Alpha Vantage (answers recorded 2026-11-27, including its rate-limit
 * notice) and SEC EDGAR (company-concept answers recorded 2026-11-28 for
 * Apple and Alphabet, trimmed to recent years; Apple's pre-2019 revenue tag).
 */

import { describe, expect, it } from "vitest";
import { ErrorCode } from "mcpy";
import { alphaVantage, MAX_QUOTES } from "../../src/providers/alphavantage/index.js";
import { conceptUrl, edgar, factsOf, mergeTags, TAGS } from "../../src/providers/edgar/index.js";
import type { FiledFact } from "../../src/providers/stock-types.js";
import { fixture, fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall } from "./call.js";

const f = (name: string) => fixture(`stocks/${name}`);
const notFound = () => new Response('<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code></Error>', { status: 404, headers: { "content-type": "application/xml" } });

describe("alphaVantage", () => {
  it("reads a global quote", async () => {
    const { fetch, calls } = stubFetch(() => json(f("alphavantage-quote-aapl.json")));
    const quotes = await alphaVantage({ apiKey: "k" }).quotes!(["AAPL"], providerCall(fetch));
    expect(quotes).toEqual([{ symbol: "AAPL", currency: "USD", price: 358.54, previousClose: 355.58, open: 358.21, dayHigh: 359.5, dayLow: 355.64, volume: 22683910, marketDate: "2026-11-27" }]);
    expect(new URL(calls[0]!.url).searchParams.get("function")).toBe("GLOBAL_QUOTE");
  });

  it("asks at most MAX_QUOTES symbols a call (each is one of the day's 25 requests), one at a time", async () => {
    const { fetch, calls } = stubFetch(() => json(f("alphavantage-quote-unknown.json")));
    const symbols = ["A", "B", "C", "D", "E", "F", "G"];
    expect(await alphaVantage({ apiKey: "k", spacingMs: 0 }).quotes!(symbols, providerCall(fetch))).toEqual([]);
    expect(calls.map((c) => new URL(c.url).searchParams.get("symbol"))).toEqual(symbols.slice(0, MAX_QUOTES));
  });

  it("treats the rate-limit notice it sends with a 200 as a failure, so the breaker sees it", async () => {
    const { fetch } = stubFetch(() => json(f("alphavantage-information.json")));
    expect((await failureOf(alphaVantage({ apiKey: "k" }).quotes!(["AAPL"], providerCall(fetch)))).code).toBe(ErrorCode.RateLimited);
    expect((await failureOf(alphaVantage({ apiKey: "k" }).history!({ symbol: "AAPL", from: "2026-11-01", to: "2026-11-27" }, providerCall(fetch)))).code).toBe(ErrorCode.RateLimited);
  });
});

describe("edgar: directory", () => {
  it("maps every ticker to its padded CIK; a company with two tickers has both", async () => {
    const { fetch } = stubFetch(() => json(f("edgar-tickers.json")));
    expect(await edgar().directory!(providerCall(fetch))).toEqual({
      AAPL: "0000320193",
      MSFT: "0000789019",
      GOOGL: "0001652044",
      GOOG: "0001652044",
      "BRK-B": "0001067983",
    });
  });
});

describe("edgar: facts", () => {
  it("keeps 10-K and 10-Q facts, marking the annual ones", () => {
    const facts = factsOf([
      { start: "2025-09-28", end: "2026-09-26", val: 132175000000, form: "10-K", filed: "2026-11-03" },
      { start: "2026-03-29", end: "2026-06-27", val: 29789000000, form: "10-Q", filed: "2026-07-31" },
      { end: "2026-09-26", val: 1, form: "8-K", filed: "2026-10-30" },
    ]);
    expect(facts).toEqual([
      { value: 132175000000, start: "2025-09-28", end: "2026-09-26", filed: "2026-11-03", annual: true },
      { value: 29789000000, start: "2026-03-29", end: "2026-06-27", filed: "2026-07-31", annual: false },
    ]);
  });

  it("merges a measure's tags: for one period the first tag wins", () => {
    const fact = (value: number, end: string): FiledFact => ({ value, start: "x", end, filed: "2020-01-01", annual: true });
    expect(mergeTags([[fact(1, "2024")], undefined, [fact(2, "2024"), fact(3, "2018")]])).toEqual([fact(1, "2024"), fact(3, "2018")]);
  });

  it("reads Apple: revenue across its two tags, net income, assets and the cover page's share count; a tag it lacks is a 404", async () => {
    const byTag: Record<string, string> = {
      RevenueFromContractWithCustomerExcludingAssessedTax: "edgar-aapl-revenue.json",
      Revenues: "edgar-aapl-revenues-old.json",
      NetIncomeLoss: "edgar-aapl-netincome.json",
      Assets: "edgar-aapl-assets.json",
      EntityCommonStockSharesOutstanding: "edgar-aapl-dei-shares.json",
    };
    const { fetch, calls } = stubFetch((url) => {
      const tag = /\/([A-Za-z]+)\.json$/.exec(url)![1]!;
      return byTag[tag] ? json(f(byTag[tag]!)) : notFound();
    });
    const filed = await edgar().fundamentals!("AAPL", "0000320193", providerCall(fetch));
    expect(calls).toHaveLength(Object.values(TAGS).flat().length);
    expect(calls[0]!.url).toBe(conceptUrl("0000320193", TAGS.revenue[0]!));
    expect(filed?.name).toBe("Apple Inc.");
    const annual = (facts: FiledFact[] | undefined, end: string) => facts?.find((x) => x.annual && x.end === end && x.start && x.start < end.slice(0, 4))?.value;
    expect(annual(filed?.facts.netIncome, "2026-09-26")).toBe(132175000000);
    expect(annual(filed?.facts.revenue, "2026-09-26")).toBe(478834000000);
    // Fiscal 2016 is only under the older tag.
    expect(annual(filed?.facts.revenue, "2016-09-24")).toBe(215639000000);
    expect(filed?.facts.grossProfit).toBeUndefined();
    expect(filed?.facts.sharesOutstanding?.length).toBeGreaterThan(0);
  });

  it("knows nothing about a company with no tags, or without an id", async () => {
    const { fetch, calls } = stubFetch(() => notFound());
    expect(await edgar().fundamentals!("ZZZZ", "0000000001", providerCall(fetch))).toBeUndefined();
    const before = calls.length;
    expect(await edgar().fundamentals!("ZZZZ", undefined, providerCall(fetch))).toBeUndefined();
    expect(calls.length).toBe(before);
  });

  it("reads Alphabet's share count from its balance sheet: the cover page states it per class, which the API leaves out", async () => {
    const { fetch } = stubFetch((url) => (url.endsWith("/us-gaap/CommonStockSharesOutstanding.json") ? json(f("edgar-googl-shares.json")) : notFound()));
    const filed = await edgar().fundamentals!("GOOGL", "0001652044", providerCall(fetch));
    const latest = filed?.facts.sharesOutstanding?.reduce((a, b) => (b.end > a.end ? b : a));
    expect(latest).toMatchObject({ end: "2026-09-30", value: fixtureJson<{ units: { shares: { end: string; val: number }[] } }>("stocks/edgar-googl-shares.json").units.shares.find((s) => s.end === "2026-09-30")!.val });
  });
});
