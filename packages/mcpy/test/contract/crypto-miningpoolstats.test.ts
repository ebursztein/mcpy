/**
 * MiningPoolStats against captured responses, recorded live on 2026-11-25:
 * the homepage's <head> (it links the coin table with the `t` the data
 * server requires) and 13 rows of coins_data.js, kept as served.
 */

import { describe, expect, it } from "vitest";
import { ErrorCode } from "mcpy";
import type { SnapshotRequest } from "../../src/providers/crypto-types.js";
import {
  coinsDataUrl,
  coinsFromData,
  difficultyChange7dPct,
  hardwareOf,
  hashesPerSecond,
  MINING_POOL_STATS_CAPABILITIES,
  miningPoolStats,
  toLiveCoin,
} from "../../src/providers/miningpoolstats/index.js";
import { CoinRowSchema } from "../../src/providers/miningpoolstats/schemas.js";
import { MiningHardware } from "../../src/schemas-crypto.js";
import { fixture, fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall } from "./call.js";

const HOME = fixture("crypto/miningpoolstats-home.html");
const COINS = fixture("crypto/miningpoolstats-coins.json");
const DATA_URL = "https://server.miningpoolstats.stream/data/coins_data.js?t=1795628261";
const rows = () => fixtureJson<{ data: Record<string, unknown>[]; time: number }>("crypto/miningpoolstats-coins.json");
const req = (over: Partial<SnapshotRequest> = {}): SnapshotRequest => ({ limit: 100, totals: false, ...over });
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });

/** Serves the homepage, then the coin table, as the live site does. */
function site(data: () => Response = () => json(COINS), home: () => Response = () => html(HOME)) {
  return stubFetch((url) => (url === "https://miningpoolstats.stream/" ? home() : url === DATA_URL ? data() : new Response("", { status: 404 })));
}

describe("miningpoolstats: request", () => {
  it("is a free live source without totals or history", () => {
    const p = miningPoolStats();
    expect(p).toMatchObject({ id: "miningpoolstats", costPerCall: 0, capabilities: { totals: false, live: true, history: false } });
    expect(MINING_POOL_STATS_CAPABILITIES).toEqual({ totals: false, live: true, history: false });
    expect(p.history).toBeUndefined();
  });

  it("finds the coin table link the homepage embeds", () => {
    expect(coinsDataUrl(HOME)).toBe(DATA_URL);
    expect(coinsDataUrl('<script src="https://server.miningpoolstats.stream/data/coins_data.js"></script>')).toBeUndefined();
  });

  it("reads the homepage, then the linked table, with no extra headers", async () => {
    const { fetch, calls } = site();
    await miningPoolStats().snapshot!(req({ symbols: ["BTC"] }), providerCall(fetch));
    expect(calls.map((c) => c.url)).toEqual(["https://miningpoolstats.stream/", DATA_URL]);
    for (const c of calls) {
      expect(c.headers.has("referer")).toBe(false);
      expect(c.headers.has("origin")).toBe(false);
    }
  });
});

describe("miningpoolstats: mapping the live table", () => {
  it("maps every figure Ravencoin's row states, exactly", async () => {
    const { fetch } = site();
    const { coins, totals } = await miningPoolStats().snapshot!(req({ symbols: ["RVN"] }), providerCall(fetch));
    expect(totals).toBeUndefined();
    expect(coins).toEqual([
      {
        symbol: "RVN",
        name: "Ravencoin",
        asOf: "2026-11-25T17:32:11.000Z",
        algorithm: "KawPow",
        minedWith: MiningHardware.Gpu,
        blockTimeTargetS: 60,
        blockHeight: 4641211,
        priceUsd: 0.00084283,
        priceChange7dPct: -22.12,
        marketCapUsd: 13978610.210698435,
        volume24hUsd: 1833804,
        networkHashrateHs: 446586872856.34,
        hashrateUnit: "H/s",
        difficulty: 6672.137727257898,
        // diff7 7895.852808 (oldest) ... 7001.145573 (newest)
        difficultyChange7dPct: -11.331356558388366,
        blockTimeS: 60.5,
        issued24hCoins: 1787500,
        pools: 48,
        poolHashrateHs: 313718206805,
      },
    ]);
  });

  it("maps every figure an ASIC coin's row states, exactly (DOGE)", () => {
    const doge = coinsFromData(rows().data).find((c) => c.symbol === "DOGE");
    expect(doge).toEqual({
      symbol: "DOGE",
      name: "Dogecoin",
      asOf: "2026-11-25T17:31:19.000Z",
      algorithm: "Scrypt",
      minedWith: MiningHardware.Asic,
      blockTimeTargetS: 60,
      blockHeight: 6472544,
      priceUsd: 0.054515,
      priceChange7dPct: -6.27,
      marketCapUsd: 8553290809.872062,
      volume24hUsd: 398005073,
      networkHashrateHs: 2650517530854168,
      hashrateUnit: "H/s",
      difficulty: 44179526.9,
      // diff7 64520943.81 (oldest) ... 44894641.6 (newest)
      difficultyChange7dPct: -30.41849832171573,
      blockTimeS: 63.5,
      issued24hCoins: 13620000,
      pools: 76,
      poolHashrateHs: 2309102374703815,
    });
  });

  it("works out the 7-day difficulty change from diff7's oldest and newest positive values", () => {
    expect(difficultyChange7dPct([100, 0, null, "150"])).toBe(50);
    expect(difficultyChange7dPct(["200", "junk", 100])).toBe(-50);
    for (const few of [[], [5], [5, 0, -1, null, "x"], null, undefined]) expect(difficultyChange7dPct(few)).toBeUndefined();
    const coins = new Map(coinsFromData(rows().data).map((c) => [c.symbol, c]));
    // Bitcoin's 7 values sit in one retarget window: no change.
    expect(coins.get("BTC")!.difficultyChange7dPct).toBe(0);
    // A bad diff7 entry is dropped, never the row.
    const row = CoinRowSchema.parse({ symbol: "ABC", time: 1795628000, diff7: [{}, 10, 12] });
    expect(toLiveCoin(row)!.difficultyChange7dPct).toBeCloseTo(20, 12);
  });

  it("never reports a 7-day hashrate change: diff7 is difficulty, p7d is price", () => {
    for (const coin of coinsFromData(rows().data)) expect(coin).not.toHaveProperty("hashrateChange7dPct");
  });

  it("reads numeric strings (DOGE's diff and time) and leaves -1 issuance unknown (ZEC)", () => {
    const coins = new Map(coinsFromData(rows().data).map((c) => [c.symbol, c]));
    expect(coins.get("DOGE")).toMatchObject({ difficulty: 44179526.9, asOf: "2026-11-25T17:31:19.000Z" });
    expect(coins.get("ZEC")!.issued24hCoins).toBeUndefined();
    expect(coins.get("ZEC")!.networkHashrateHs).toBe(41551513828);
  });

  it("reports nothing for missing or zero figures, never 0", () => {
    const row = CoinRowSchema.parse({ symbol: "abc", pr: 0, mc: null, v24: 0, c7d: -3, hashrate: 0, unit: "H/s", e24: -1, pools: 0, height: 0, time: 1795628000 });
    const coin = toLiveCoin(row)!;
    expect(coin.symbol).toBe("ABC");
    for (const field of ["priceUsd", "priceChange7dPct", "marketCapUsd", "volume24hUsd", "networkHashrateHs", "issued24hCoins", "pools", "blockHeight"] as const)
      expect(coin[field]).toBeUndefined();
  });

  it("takes the reading time from the file when a row has none, and skips a row with neither", () => {
    const row = CoinRowSchema.parse({ symbol: "ABC" });
    expect(toLiveCoin(row, 1795628261)!.asOf).toBe("2026-11-25T17:37:41.000Z");
    expect(toLiveCoin(row)).toBeUndefined();
  });

  it("skips a malformed row, never the whole table", () => {
    const data = [...rows().data, { name: "no symbol" }, { symbol: "BAD", pr: "a lot", time: 1795628000 }, "junk"];
    const coins = coinsFromData(data);
    expect(coins).toHaveLength(11);
    expect(coins.map((c) => c.symbol)).not.toContain("BAD");
  });
});

describe("miningpoolstats: units and hardware", () => {
  it("states hashrates in H/s, Sol/s as such, and drops units of other work", () => {
    expect(hashesPerSecond(5, "H/s")).toBe(5);
    expect(hashesPerSecond(5, "Sol/s")).toBe(5);
    expect(hashesPerSecond(5, "KH/s")).toBe(5000);
    expect(hashesPerSecond(2, "GH/s")).toBe(2e9);
    expect(hashesPerSecond(3, "MSol/s")).toBe(3e6);
    for (const unit of ["Gps", "B/s", "c/s", "It/s", "iB", "H", "", null]) expect(hashesPerSecond(5, unit)).toBeUndefined();
    expect(hashesPerSecond(0, "H/s")).toBeUndefined();
  });

  it("leaves hashrate unknown for Cuckoo graphs and storage proofs (GRIN, XCH)", () => {
    const coins = new Map(coinsFromData(rows().data).map((c) => [c.symbol, c]));
    expect(coins.get("GRIN")).toMatchObject({ priceUsd: 0.01138915, difficulty: expect.any(Number) });
    expect(coins.get("GRIN")!.networkHashrateHs).toBeUndefined();
    expect(coins.get("GRIN")!.poolHashrateHs).toBeUndefined();
    expect(coins.get("XCH")!.networkHashrateHs).toBeUndefined();
  });

  it("maps ASIC, GPU and CPU; HDD and blank say nothing", () => {
    expect([hardwareOf("ASIC"), hardwareOf("GPU"), hardwareOf("cpu")]).toEqual([MiningHardware.Asic, MiningHardware.Gpu, MiningHardware.Cpu]);
    expect([hardwareOf("HDD"), hardwareOf(""), hardwareOf(undefined)]).toEqual([undefined, undefined, undefined]);
    const coins = new Map(coinsFromData(rows().data).map((c) => [c.symbol, c]));
    expect(coins.get("XMR")!.minedWith).toBe(MiningHardware.Cpu);
    expect(coins.get("NMC")!.minedWith).toBeUndefined();
  });
});

describe("miningpoolstats: selecting coins", () => {
  it("keeps one row per symbol: largest market cap, then most pools", () => {
    const coins = new Map(coinsFromData(rows().data).map((c) => [c.symbol, c]));
    // DigiByte: a row per algorithm, same market cap; SHA-256 has the most pools (68 vs 28).
    expect(coins.get("DGB")).toMatchObject({ algorithm: "SHA-256", pools: 68, networkHashrateHs: 47634253086500560 });
    // Two unrelated coins share MYT: Mytherra has a market cap, MYT Coin none.
    expect(coins.get("MYT")).toMatchObject({ name: "Mytherra", marketCapUsd: 2979.2603400000003 });
  });

  it("returns only the coins asked for, compared upper-case, unknown ones left out", async () => {
    const { fetch } = site();
    const { coins } = await miningPoolStats().snapshot!(req({ symbols: ["kas", "XMR", "NOPE"] }), providerCall(fetch));
    expect(coins.map((c) => c.symbol).sort()).toEqual(["KAS", "XMR"]);
  });

  it("without symbols, lists the largest coins by market cap", async () => {
    const { fetch } = site();
    const { coins } = await miningPoolStats().snapshot!(req({ limit: 5 }), providerCall(fetch));
    expect(coins.map((c) => c.symbol)).toEqual(["BTC", "ZEC", "XMR", "DOGE", "KAS"]);
    const all = await miningPoolStats().snapshot!(req({ limit: 100 }), providerCall(site().fetch));
    expect(all.coins).toHaveLength(11);
    expect(all.coins.at(-1)!.symbol).toBe("MYT");
  });
});

describe("miningpoolstats: failures", () => {
  it("fails when the homepage no longer links the coin table", async () => {
    const { fetch, calls } = site(undefined, () => html("<html><head></head></html>"));
    const err = await failureOf(miningPoolStats().snapshot!(req(), providerCall(fetch)));
    expect(err.code).toBe(ErrorCode.UpstreamFailed);
    expect(err.message).toMatch(/link not found/);
    expect(calls).toHaveLength(1);
  });

  it("fails on an HTTP error from the homepage", async () => {
    const { fetch } = site(undefined, () => html("busy", 503));
    const err = await failureOf(miningPoolStats().snapshot!(req(), providerCall(fetch)));
    expect(err).toMatchObject({ code: ErrorCode.UpstreamFailed, status: 503 });
  });

  it("fails on a 403 from the data server", async () => {
    const { fetch } = site(() => html("<html>403 Forbidden</html>", 403));
    const err = await failureOf(miningPoolStats().snapshot!(req(), providerCall(fetch)));
    expect(err).toMatchObject({ code: ErrorCode.UpstreamFailed, status: 403 });
  });

  it("fails on a table that is not {data: [...]}", async () => {
    const { fetch } = site(() => json({ coins: [] }));
    const err = await failureOf(miningPoolStats().snapshot!(req(), providerCall(fetch)));
    expect(err.code).toBe(ErrorCode.BadResponse);
  });
});
