/** Scripted crypto sources shared by the crypto tests. */

import type { CryptoProvider, CryptoSnapshot, FoundCoinDay, HistoryRequest, SnapshotRequest } from "mcpy/providers";

export const NOW = new Date().toISOString();
export const today = NOW.slice(0, 10);
export const dayBefore = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export function live(id: string, snapshot: CryptoSnapshot | Error, totals = false): CryptoProvider & { asked: SnapshotRequest[] } {
  const asked: SnapshotRequest[] = [];
  return {
    id,
    costPerCall: 0,
    capabilities: { totals, live: true, history: false },
    asked,
    async snapshot(req) {
      asked.push(req);
      if (snapshot instanceof Error) throw snapshot;
      return snapshot;
    },
  };
}

export function past(id: string, days: FoundCoinDay[] | Error): CryptoProvider & { asked: HistoryRequest[] } {
  const asked: HistoryRequest[] = [];
  return {
    id,
    costPerCall: 0,
    capabilities: { totals: false, live: false, history: true },
    asked,
    async history(req) {
      asked.push(req);
      if (days instanceof Error) throw days;
      return days;
    },
  };
}

export const prices = live(
  "prices",
  {
    totals: { asOf: NOW, totalMarketCapUsd: 2.9e12, btcDominancePct: 58 },
    coins: [
      { symbol: "BTC", name: "Bitcoin", asOf: NOW, priceUsd: 60_000, marketCapUsd: 1.2e12 },
      { symbol: "ETH", name: "Ethereum", asOf: NOW, priceUsd: 3_000, marketCapUsd: 3.6e11 },
      { symbol: "RVN", name: "Ravencoin", asOf: NOW, priceUsd: 0.0008, marketCapUsd: 1.3e7 },
    ],
  },
  true,
);
export const network = live("network", {
  coins: [
    // A second opinion on BTC's price never replaces the first source's.
    { symbol: "btc", asOf: NOW, priceUsd: 59_000, algorithm: "SHA-256", networkHashrateHs: 1e21, difficulty: 1.3e14, issued24hCoins: 450 },
    { symbol: "ZEC", name: "Zcash", asOf: NOW, priceUsd: 50, marketCapUsd: 8e8, networkHashrateHs: 1.2e10, issued24hCoins: 600 },
  ],
});

