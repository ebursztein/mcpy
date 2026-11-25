/**
 * Kaspa's REST API against captured responses, recorded live on 2026-11-25:
 * the day 2026-11-24 in full (96 samples), 2026-11-25 up to 18:39 (a partial
 * day), and 2025-05-04/05 from the May 2025 month (Crescendo's day).
 */

import { describe, expect, it } from "vitest";
import { ErrorCode } from "mcpy";
import type { HistoryRequest } from "../../src/providers/crypto-types.js";
import { blocksInDay, coversDay, daysFromSamples, historyUrl, kaspa, KASPA_CAPABILITIES, monthsBetween } from "../../src/providers/kaspa/index.js";
import { SampleSchema, type Sample } from "../../src/providers/kaspa/schemas.js";
import { fixture, fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall } from "./call.js";

const DAY = fixture("crypto/kaspa-history-2026-11-24.json");
const day = () => fixtureJson<unknown[]>("crypto/kaspa-history-2026-11-24.json");
const partial = () => fixtureJson<unknown[]>("crypto/kaspa-history-2026-11-25-partial.json");
const crescendo = () => fixtureJson<unknown[]>("crypto/kaspa-history-2025-05-04-05.json");
const req = (over: Partial<HistoryRequest> = {}): HistoryRequest => ({ symbols: ["KAS"], from: "2026-11-24", to: "2026-11-24", ...over });
const samples = (raw: unknown[]) => raw.map((s) => SampleSchema.parse(s)).sort((a, b) => a.timestamp - b.timestamp);

describe("kaspa: request", () => {
  it("is a free history source without live figures or totals", () => {
    const p = kaspa();
    expect(p).toMatchObject({ id: "kaspa", costPerCall: 0, capabilities: { totals: false, live: false, history: true } });
    expect(KASPA_CAPABILITIES).toEqual({ totals: false, live: false, history: true });
    expect(p.snapshot).toBeUndefined();
  });

  it("asks for each month of the window", () => {
    expect(monthsBetween("2026-11-03", "2026-11-24")).toEqual(["2026-11"]);
    expect(monthsBetween("2026-10-20", "2026-11-24")).toEqual(["2026-10", "2026-11"]);
    expect(monthsBetween("2025-12-31", "2026-02-08")).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(historyUrl("2026-11")).toBe("https://api.kaspa.org/info/hashrate/history/2026-11");
  });

  it("fetches the months in parallel and only for KAS", async () => {
    const { fetch, calls } = stubFetch(() => json(DAY));
    await kaspa().history!(req({ symbols: ["BTC", "kas"], from: "2026-10-30", to: "2026-11-24" }), providerCall(fetch));
    expect(calls.map((c) => c.url).filter((u) => u.startsWith(historyUrl(""))).sort()).toEqual([historyUrl("2026-10"), historyUrl("2026-11")]);
  });

  it("makes no request without KAS", async () => {
    const { fetch, calls } = stubFetch(() => json(DAY));
    expect(await kaspa().history!(req({ symbols: ["BTC", "ZEC"] }), providerCall(fetch))).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("kaspa: days from the live samples", () => {
  it("maps a complete day exactly", async () => {
    const { fetch } = stubFetch(() => json(DAY));
    const days = await kaspa().history!(req(), providerCall(fetch));
    expect(days).toEqual([
      {
        symbol: "KAS",
        name: "Kaspa",
        date: "2026-11-24",
        // Mean of 96 samples' hashrate_kh × 1000.
        networkHashrateHs: 313285424151617700,
        // The 23:53:26 sample's.
        difficulty: 16070779732615656,
        blocks: 864_000,
      },
    ]);
  });

  it("states hashrate in H/s: kH/s × 1000, the same as difficulty × 2 × 10 blocks a second", () => {
    for (const s of samples(day())) expect((s.hashrate_kh * 1000) / (s.difficulty * 20)).toBeCloseTo(1, 12);
  });

  it("leaves out a day its samples do not cover (today, up to 18:39)", () => {
    const all = [...day(), ...partial()];
    expect(daysFromSamples(all, "2026-11-24", "2026-11-25", "2026-11-26").map((d) => d.date)).toEqual(["2026-11-24"]);
    expect(coversDay("2026-11-25", samples(partial()))).toBe(false);
  });

  it("needs 80 samples, the first before 01:00 and the last after 23:00", () => {
    const full = samples(day());
    expect(coversDay("2026-11-24", full)).toBe(true);
    expect(coversDay("2026-11-24", full.slice(0, 79).concat(full.slice(-1)))).toBe(true);
    expect(coversDay("2026-11-24", full.slice(0, 40).concat(full.slice(-39)))).toBe(false);
    expect(coversDay("2026-11-24", full.filter((s) => s.timestamp >= Date.parse("2026-11-24T01:00:00Z")))).toBe(false);
    expect(coversDay("2026-11-24", full.filter((s) => s.timestamp <= Date.parse("2026-11-24T23:00:00Z")))).toBe(false);
  });

  it("never reports today or a day outside from..to", () => {
    const all = [...day(), ...partial()];
    expect(daysFromSamples(all, "2026-11-24", "2026-11-25", "2026-11-24")).toEqual([]);
    expect(daysFromSamples(all, "2026-11-25", "2026-11-25", "2026-11-26")).toEqual([]);
    expect(daysFromSamples(all, "2026-11-01", "2026-11-23", "2026-11-26")).toEqual([]);
  });

  it("skips a malformed sample and counts each sample once", () => {
    const raw = [...day(), "junk", { timestamp: Date.parse("2026-11-24T12:00:00Z"), difficulty: -1, hashrate_kh: 1 }, ...day()];
    const [d] = daysFromSamples(raw, "2026-11-24", "2026-11-24", "2026-11-25");
    expect(d.networkHashrateHs).toBe(313285424151617700);
  });

  it("counts blocks at the rate the samples show: 86,400 before Crescendo, none on its day", () => {
    const days = daysFromSamples(crescendo(), "2025-05-04", "2025-05-05", "2026-11-25");
    expect(days).toEqual([
      { symbol: "KAS", name: "Kaspa", date: "2025-05-04", networkHashrateHs: 1072977957433377400, difficulty: 530722239027831550, blocks: 86_400 },
      { symbol: "KAS", name: "Kaspa", date: "2025-05-05", networkHashrateHs: 1040334857421074600, difficulty: 50069622151805050, blocks: undefined },
    ]);
    const mixed: Sample[] = [
      { timestamp: 0, difficulty: 10, hashrate_kh: 0.02 },
      { timestamp: 1, difficulty: 10, hashrate_kh: 0.2 },
    ];
    expect(blocksInDay(mixed)).toBeUndefined();
    expect(blocksInDay(mixed.slice(1))).toBe(864_000);
  });
});

describe("kaspa: failures", () => {
  it("fails on an HTTP error", async () => {
    const { fetch } = stubFetch(() => json({ message: "Internal server error" }, 500));
    const err = await failureOf(kaspa().history!(req(), providerCall(fetch)));
    expect(err).toMatchObject({ code: ErrorCode.UpstreamFailed, status: 500 });
  });

  it("fails on a body that is not a list of samples", async () => {
    const { fetch } = stubFetch(() => json({ samples: [] }));
    const err = await failureOf(kaspa().history!(req(), providerCall(fetch)));
    expect(err.code).toBe(ErrorCode.BadResponse);
  });

  it("returns no days for a month the API has nothing for", async () => {
    const { fetch } = stubFetch(() => json([]));
    expect(await kaspa().history!(req(), providerCall(fetch))).toEqual([]);
  });
});
