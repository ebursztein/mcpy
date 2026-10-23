import { describe, expect, it } from "vitest";
import { SearchMode } from "mcpy";
import { settleWithGrace } from "../../src/engine/fanout.js";
import { fakeSearch, testMcpy } from "../helpers.js";

const after = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const failAfter = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("boom")), ms));

describe("settleWithGrace", () => {
  it("waits a grace period after the first answer, then leaves stragglers out", async () => {
    const t = Date.now();
    const out = await settleWithGrace([after(10, "fast"), after(40, "ok"), after(5_000, "slow")], 100);
    expect(Date.now() - t).toBeLessThan(1_000);
    expect(out).toEqual([{ status: "fulfilled", value: "fast" }, { status: "fulfilled", value: "ok" }, { status: "late" }]);
  });

  it("waits for everything when nothing succeeds", async () => {
    const out = await settleWithGrace([failAfter(10), failAfter(30)], 5);
    expect(out.map((o) => o.status)).toEqual(["rejected", "rejected"]);
  });

  it("handles no tasks", async () => {
    expect(await settleWithGrace([], 10)).toEqual([]);
  });
});

describe("thorough mode does not wait for the slowest source", () => {
  // Regression: thorough paper search took 55 s because one index was slow.
  it("answers with the sources that made it within the grace period", async () => {
    const quick = fakeSearch("quick", [{ url: "https://a.example/", title: "A", snippet: "" }]);
    const slow = { ...fakeSearch("slow", []), search: () => after(5_000, []) };
    const { mcpy } = testMcpy({ search: [quick, slow], limits: { thoroughGraceMs: 50 } });
    const t = Date.now();
    const r = await mcpy.search({ query: "q", mode: SearchMode.Thorough });
    expect(Date.now() - t).toBeLessThan(2_000);
    expect(r.results.map((h) => h.url)).toEqual(["https://a.example/"]);
  });
});
