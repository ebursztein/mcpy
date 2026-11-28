/**
 * 2026-11-27: a failed operation set its cost on the span after span.end(),
 * and a span ignores writes after end, so every failed call reached traces and
 * Analytics Engine with no cost, even when its paid attempts were billed.
 * Never delete this.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode } from "mcpy";
import { ProviderFailure } from "mcpy/providers";
import { fakePages, testMcpy } from "../helpers.js";

describe("a failed call's span", () => {
  it("carries what its paid attempts cost, and its cache reads", async () => {
    const paid = fakePages("paid", new ProviderFailure(ErrorCode.UpstreamFailed, "boom"), 0.004);
    const { mcpy, sink } = testMcpy({ pages: [paid] });
    await expect(mcpy.fetch({ url: "https://shop.example/x" })).rejects.toBeDefined();
    const op = sink.spans.find((s) => s.name === "mcpy.operation");
    expect(op?.attributes["mcpy.cost.usd"]).toBeGreaterThan(0);
    expect(op?.attributes["mcpy.cache.reads.missed"]).toBe(3);
  });
});
