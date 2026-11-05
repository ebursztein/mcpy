import { describe, expect, it } from "vitest";
import { ErrorCode, McpyError, SearchMode, type SpendLimit } from "mcpy";
import { Attr } from "mcpy/telemetry";
import { fakePages, fakeSearch, LONG_TEXT, page, testMcpy } from "../helpers.js";

const HIT = { url: "https://example.com/", title: "Hit", snippet: "" };

/** A limit with `allowance` USD left; records every charge. */
function limit(allowance: number, opts: { failAllows?: boolean } = {}): SpendLimit & { asked: number; charges: number[] } {
  const l = {
    asked: 0,
    charges: [] as number[],
    async allows() {
      l.asked++;
      if (opts.failAllows) throw new Error("budget store down");
      return l.charges.reduce((a, b) => a + b, 0) < allowance;
    },
    async record(usd: number) {
      l.charges.push(usd);
    },
  };
  return l;
}

const failure = async (p: Promise<unknown>) => {
  const err = await p.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(McpyError);
  return err as McpyError;
};

describe("spending limits", () => {
  it("records what each operation spent", async () => {
    const spend = limit(1);
    const { mcpy } = testMcpy({ search: [fakeSearch("paid", [HIT], 0.002)] });
    await mcpy.with({ spendLimit: spend }).search({ query: "a" });
    expect(spend.charges).toEqual([0.002]);
  });

  it("over the limit, skips paid sources and still uses free ones", async () => {
    const free = fakePages("free", page({ content: LONG_TEXT }));
    const paid = fakePages("paid", page({ content: LONG_TEXT }), 0.001);
    const { mcpy } = testMcpy({ pages: [paid, free] });
    const r = await mcpy.with({ spendLimit: limit(0) }).fetch({ url: "https://example.com/a" });
    expect(r.content).toContain("Lorem");
    expect([paid.calls.length, free.calls.length]).toEqual([0, 1]);
  });

  it("over the limit with only paid sources, says the limit is the reason", async () => {
    const paid = fakeSearch("paid", [HIT], 0.002);
    const { mcpy } = testMcpy({ search: [paid] });
    const err = await failure(mcpy.with({ spendLimit: limit(0) }).search({ query: "a" }));
    expect(err.code).toBe(ErrorCode.BudgetExceeded);
    expect(err.httpStatus).toBe(429);
    expect(paid.calls).toBe(0);
  });

  it("thorough mode reports the limit rather than another source's failure", async () => {
    const broken = fakeSearch("broken", new Error("down"));
    const paid = fakeSearch("paid", [HIT], 0.002);
    const { mcpy } = testMcpy({ search: [broken, paid], retry: { retries: 0 } });
    const err = await failure(mcpy.with({ spendLimit: limit(0) }).search({ query: "a", mode: SearchMode.Thorough }));
    expect(err.code).toBe(ErrorCode.BudgetExceeded);
  });

  it("never asks the limit for cache hits or free sources", async () => {
    const spend = limit(0);
    const { mcpy } = testMcpy({ pages: [fakePages("free", page({ content: LONG_TEXT }))] });
    const api = mcpy.with({ spendLimit: spend });
    await api.fetch({ url: "https://example.com/b" });
    await api.fetch({ url: "https://example.com/b" });
    expect(spend.asked).toBe(0);
    expect(spend.charges).toEqual([]);
  });

  it("asks at most once per operation, however many paid sources it tries", async () => {
    const spend = limit(1);
    const { mcpy } = testMcpy({ search: [fakeSearch("a", [], 0.002), fakeSearch("b", [HIT], 0.0015)] });
    await mcpy.with({ spendLimit: spend }).search({ query: "a" });
    expect(spend.asked).toBe(1);
    expect(spend.charges[0]).toBeCloseTo(0.0035, 10);
  });

  it("fails open, with an error log, when the limit cannot answer", async () => {
    const spend = limit(0, { failAllows: true });
    const { mcpy, sink } = testMcpy({ search: [fakeSearch("paid", [HIT], 0.002)] });
    const r = await mcpy.with({ spendLimit: spend }).search({ query: "a" });
    expect(r.results).toHaveLength(1);
    expect(sink.logs.some((l) => l.message.includes("spending limit unavailable"))).toBe(true);
  });

  it("puts the operation's cost on its log line", async () => {
    const { mcpy, sink } = testMcpy({ search: [fakeSearch("paid", [HIT], 0.002)] });
    await mcpy.search({ query: "a" });
    expect(sink.logs.find((l) => l.message === "search ok")?.attributes[Attr.CostUsd]).toBe(0.002);
  });
});
