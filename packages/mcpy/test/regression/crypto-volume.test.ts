/**
 * Regression (2026-11-25): a complete day's volume came from Coin Metrics' reported spot
 * volume while the live day's came from CoinGecko's total volume across markets: for BTC
 * $10.2B against $34.0B under one name. Each measure now has its own field, so a past day
 * and today compare like with like.
 */

import { describe, expect, it } from "vitest";
import type { CryptoProvider, FoundCoinDay } from "mcpy/providers";
import { testMcpy } from "../helpers.js";

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const history = (id: string, day: Partial<FoundCoinDay>): CryptoProvider => ({
  id,
  costPerCall: 0,
  capabilities: { totals: false, live: false, history: true },
  history: async () => [{ symbol: "BTC", date: yesterday, ...day }],
});

describe("crypto day volume", () => {
  it("keeps total trading volume and reported spot volume apart, whichever source comes first", async () => {
    const spot = history("spot", { reportedSpotVolumeUsd: 10.2e9, priceUsd: 59_790 });
    const total = history("total", { volumeUsd: 34.0e9, priceUsd: 59_800 });
    const { mcpy } = testMcpy({ crypto: [spot, total] });
    const [day] = (await mcpy.cryptoCoin({ symbols: ["BTC"], from: yesterday, to: yesterday })).coins[0].days;
    expect(day).toMatchObject({ volume_24h_usd: 34.0e9, reported_spot_volume_usd: 10.2e9 });
  });
});
