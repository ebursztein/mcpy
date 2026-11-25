/**
 * Regression (2026-11-25): block rewards came from schedules written into rules.ts, not from
 * the chain (owner: block figures always come from data).
 * - DASH's miners were credited 20% of a scheduled 1.8479 DASH a block, 0.3696, while its blocks'
 *   coinbases paid them 0.41097 (a quarter of the 1.64388 payout): 11% too little.
 * - KAS's subsidy was a hand-copied monthly table that would silently go stale past its end.
 * Both now come from the chain: DASH's coinbase payout, KAS's coinbase subsidy.
 */

import { describe, expect, it } from "vitest";
import { testMcpy } from "../helpers.js";
import { past } from "../unit/crypto-fakes.js";

const day = "2026-11-24";

describe("block rewards from the chain", () => {
  it("credits DASH's miners a quarter of the coinbase payout its blocks made, not a scheduled subsidy", async () => {
    // Coin Metrics: blocks, price, hashrate and an issuance that holds superblocks; Insight: the payout.
    const network = past("coinmetrics", [{ symbol: "DASH", date: day, blocks: 551, issuedCoins: 1293.09, priceUsd: 42, networkHashrateHs: 3.66e15 }]);
    const chain = past("dash", [{ symbol: "DASH", date: day, coinbasePerBlockCoins: 1.64388266 }]);
    const { mcpy } = testMcpy({ crypto: [network, chain] });
    const [d] = (await mcpy.cryptoCoin({ symbols: ["DASH"], from: day, to: day })).coins[0].days;
    expect(d.miner_subsidy_coins).toBeCloseTo(551 * 0.41097067, 4);
    expect(d.hashprice_usd_per_hs_day).toBeCloseTo((42 * 551 * 0.41097067) / 3.66e15, 18);
  });

  it("gives DASH no miners' subsidy on a day without a payout reading, never a guess", async () => {
    const network = past("coinmetrics", [{ symbol: "DASH", date: day, blocks: 551, issuedCoins: 1293.09, priceUsd: 42, networkHashrateHs: 3.66e15 }]);
    const { mcpy } = testMcpy({ crypto: [network] });
    const [d] = (await mcpy.cryptoCoin({ symbols: ["DASH"], from: day, to: day })).coins[0].days;
    expect(d).not.toHaveProperty("miner_subsidy_coins");
    expect(d).not.toHaveProperty("hashprice_usd_per_hs_day");
  });

  it("takes KAS's miners' subsidy from the issuance its source reads off the chain, whatever the month (before the old table too)", async () => {
    const far = "2026-08-01"; // before the old hand-copied table began
    const kas = past("kaspa", [{ symbol: "KAS", date: far, blocks: 864_000, issuedCoins: 864_000 * 0.1, networkHashrateHs: 3e17 }]);
    const { mcpy } = testMcpy({ crypto: [kas] });
    const [d] = (await mcpy.cryptoCoin({ symbols: ["KAS"], from: far, to: far })).coins[0].days;
    expect(d.miner_subsidy_coins).toBeCloseTo(86_400, 6);
  });
});

describe("DASH's live hashprice", () => {
  // Regression (2026-11-25): the live estimate took coins per block from reported issuance, which for
  // DASH holds treasury superblocks (Coin Metrics, 2026-11-20: 14.2 DASH a block against a 1.64 payout).
  it("comes from the latest day's coinbase payout, not its reported issuance", async () => {
    const { live } = await import("../unit/crypto-fakes.js");
    const now = live("network", { coins: [{ symbol: "DASH", asOf: new Date().toISOString(), priceUsd: 35.61, networkHashrateHs: 2.66e15, blockTimeS: 158.2 }] });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const network = past("coinmetrics", [{ symbol: "DASH", date: yesterday, blocks: 545, issuedCoins: 7_751.43 }]);
    const chain = past("dash", [{ symbol: "DASH", date: yesterday, coinbasePerBlockCoins: 1.6442024 }]);
    const { mcpy } = testMcpy({ crypto: [now, network, chain] });
    const [row] = (await mcpy.cryptoMarket({ symbols: ["DASH"] })).coins;
    expect(row.hashprice_usd_per_hs_day).toBeCloseTo((35.61 * 0.25 * 1.6442024 * (86_400 / 158.2)) / 2.66e15, 20);
  });
});
