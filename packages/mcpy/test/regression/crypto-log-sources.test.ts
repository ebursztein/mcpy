/**
 * Regression (2026-11-25, production): the usage log credited a merged day to its first
 * source only. KAS's complete days read "coinmetrics" although their hashrate and blocks came
 * from Kaspa's API, so a wrong network figure could not be traced. The log now names every
 * source that supplied a field, in order.
 */

import { describe, expect, it } from "vitest";
import type { CryptoProvider, FoundCoinDay } from "mcpy/providers";
import { testMcpy } from "../helpers.js";

const day = "2026-11-20";
const history = (id: string, fields: Partial<FoundCoinDay>): CryptoProvider => ({
  id,
  costPerCall: 0,
  capabilities: { totals: false, live: false, history: true },
  history: async () => [{ symbol: "KAS", date: day, ...fields }],
});

describe("crypto_coin log sources", () => {
  it("names every source that supplied a field of a merged day, and none that added nothing", async () => {
    const served: { parts?: Record<string, string> }[] = [];
    const prices = history("coinmetrics", { priceUsd: 0.027 });
    const network = history("kaspa", { networkHashrateHs: 3.2e17, blocks: 864_000 });
    const echo = history("coingecko", { priceUsd: 0.028 }); // price already filled: adds nothing
    const { mcpy } = testMcpy({ crypto: [prices, network, echo] });
    await mcpy.with({ onServed: (s) => void served.push(s) }).cryptoCoin({ symbols: ["KAS"], from: day, to: day });
    expect(served[0].parts).toEqual({ "KAS complete": "coinmetrics+kaspa" });
  });
});
