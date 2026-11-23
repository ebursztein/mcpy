import { describe, expect, it } from "vitest";
import { ErrorCode, QuotaAlertKind, type QuotaAlert } from "mcpy";
import { ProviderFailure } from "../../src/errors.js";
import { fakeSearch, testMcpy } from "../helpers.js";

const hit = [{ url: "https://example.com/", title: "Hit", snippet: "" }];
const refused = (status: number) => new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${status}`, status);

describe("quota alerts", () => {
  it("reports a paid source out of credits (402) and still falls back", async () => {
    const alerts: QuotaAlert[] = [];
    const { mcpy } = testMcpy({ search: [fakeSearch("paid", refused(402), 0.002), fakeSearch("backup", hit, 0.001)], retry: { retries: 0 } });
    const result = await mcpy.with({ onQuota: (a) => void alerts.push(a) }).search({ query: "q", max_age: 0 });
    expect(result.results).toHaveLength(1);
    expect(alerts).toEqual([{ kind: QuotaAlertKind.OutOfCredits, provider: "paid", status: 402 }]);
  });

  it("reports a paid source's 429 as rate limited", async () => {
    const alerts: QuotaAlert[] = [];
    const { mcpy } = testMcpy({ search: [fakeSearch("paid", refused(429), 0.002), fakeSearch("backup", hit)], retry: { retries: 0 } });
    await mcpy.with({ onQuota: (a) => void alerts.push(a) }).search({ query: "q", max_age: 0 });
    expect(alerts.map((a) => a.kind)).toEqual([QuotaAlertKind.RateLimited]);
  });

  it("ignores free sources and failures that are not about the account", async () => {
    const alerts: QuotaAlert[] = [];
    const { mcpy } = testMcpy({
      search: [fakeSearch("free", refused(429)), fakeSearch("paid", refused(500), 0.002), fakeSearch("backup", hit)],
      retry: { retries: 0 },
    });
    await mcpy.with({ onQuota: (a) => void alerts.push(a) }).search({ query: "q", max_age: 0 });
    expect(alerts).toEqual([]);
  });

  it("a failing sink is logged and never reaches the caller", async () => {
    const { mcpy, sink } = testMcpy({ search: [fakeSearch("paid", refused(402), 0.002), fakeSearch("backup", hit)], retry: { retries: 0 } });
    const deferred: Promise<unknown>[] = [];
    const api = mcpy.with({ onQuota: () => Promise.reject(new Error("pager down")), defer: (w) => void deferred.push(w) });
    await expect(api.search({ query: "q", max_age: 0 })).resolves.toBeDefined();
    await Promise.all(deferred);
    expect(sink.logs.some((l) => l.message === "quota alert failed")).toBe(true);
  });
});
