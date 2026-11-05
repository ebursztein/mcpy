/**
 * 2026-11-04: one client (cardy) ran ~130 calls an hour for two days and
 * used up the Firecrawl plan, then kept spending on Bright Data. Nothing
 * capped a client's spending, and failed operations reported no cost at
 * all, so metrics undercounted what it spent. Never delete these.
 */

import { describe, expect, it } from "vitest";
import { ErrorCode, McpyError, type SpendLimit } from "mcpy";
import { Attr } from "mcpy/telemetry";
import { fakeSearch, testMcpy } from "../helpers.js";

describe("spending regressions", () => {
  it("a failed operation still reports and records what its attempts cost", async () => {
    const charges: number[] = [];
    const spendLimit: SpendLimit = { allows: async () => true, record: async (usd) => void charges.push(usd) };
    const { mcpy, sink } = testMcpy({ search: [fakeSearch("a", new Error("down"), 0.002), fakeSearch("b", new Error("down"), 0.0015)], retry: { retries: 0 } });
    await expect(mcpy.with({ spendLimit }).search({ query: "q" })).rejects.toBeInstanceOf(McpyError);
    expect(charges[0]).toBeCloseTo(0.0035, 10);
    expect(sink.logs.find((l) => l.message === "search failed")?.attributes[Attr.CostUsd]).toBeCloseTo(0.0035, 10);
  });

  it("a client over its cap can no longer spend on paid sources", async () => {
    let spent = 0;
    const cap = 0.004;
    const spendLimit: SpendLimit = { allows: async () => spent < cap, record: async (usd) => void (spent += usd) };
    const paid = fakeSearch("paid", [{ url: "https://example.com/", title: "Hit", snippet: "" }], 0.002);
    const { mcpy } = testMcpy({ search: [paid] });
    const api = mcpy.with({ spendLimit });
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push(await api.search({ query: `q${i}` }).then(() => "ok", (e: McpyError) => e.code));
    }
    expect(codes).toEqual(["ok", "ok", ErrorCode.BudgetExceeded, ErrorCode.BudgetExceeded, ErrorCode.BudgetExceeded]);
    expect(paid.calls).toBe(2);
  });
});
