/**
 * Contract for crypto data sources (market data, network statistics). The
 * engine merges what several sources report about the same coin, field by
 * field in configured order; callers never learn which source said what.
 * A source reports only figures it has, as the source states them (never
 * read back from a rounded display), and leaves the rest undefined.
 */

import type { HashrateUnit, MiningHardware } from "../schemas-crypto.js";
import type { ProviderCall } from "./types.js";

/** The live market: every symbol upper-case. */
export interface SnapshotRequest {
  /** Only these coins; unset: the largest coins by market cap. */
  symbols?: string[];
  /** Most coins wanted when `symbols` is unset. */
  limit: number;
  /** Also report whole-market totals (sources with `totals`); false spares the call. */
  totals: boolean;
}

/** Complete UTC days, `from` to `to` included; `to` is before today. */
export interface HistoryRequest {
  symbols: string[];
  from: string;
  to: string;
}

/** Whole-market totals, now. */
export interface FoundTotals {
  asOf: string;
  totalMarketCapUsd: number;
  totalVolume24hUsd?: number;
  btcDominancePct?: number;
  totalMarketCapChange24hPct?: number;
  /** Coins the source tracks. */
  activeCoins?: number;
  /** Exchange markets the source tracks. */
  markets?: number;
}

/** One coin as a source sees it now. */
export interface FoundLiveCoin {
  symbol: string;
  name?: string;
  asOf: string;
  algorithm?: string;
  minedWith?: MiningHardware;
  blockTimeTargetS?: number;
  blockHeight?: number;
  priceUsd?: number;
  priceChange24hPct?: number;
  priceChange7dPct?: number;
  high24hUsd?: number;
  low24hUsd?: number;
  allTimeHighUsd?: number;
  /** YYYY-MM-DD */
  allTimeHighDate?: string;
  marketCapUsd?: number;
  marketCapRank?: number;
  fullyDilutedValueUsd?: number;
  volume24hUsd?: number;
  /** Circulating supply. */
  supply?: number;
  totalSupply?: number;
  maxSupply?: number;
  networkHashrateHs?: number;
  /** What the source's hashrate counts (Sol/s for Equihash coins). */
  hashrateUnit?: HashrateUnit;
  difficulty?: number;
  /** Change from the oldest of the source's last 7 daily difficulties to the newest (6 days apart), in percent. */
  difficultyChange7dPct?: number;
  blockTimeS?: number;
  /** Every coin issued over the last 24 hours, miners' or not. */
  issued24hCoins?: number;
  pools?: number;
  poolHashrateHs?: number;
}

export interface CryptoSnapshot {
  totals?: FoundTotals;
  coins: FoundLiveCoin[];
}

/** One coin on one complete UTC day. */
export interface FoundCoinDay {
  symbol: string;
  name?: string;
  /** YYYY-MM-DD */
  date: string;
  priceUsd?: number;
  marketCapUsd?: number;
  supply?: number;
  /** Trading volume across every market the source tracks (the live day's volume24hUsd, for a past day). */
  volumeUsd?: number;
  /** Spot volume as exchanges report it, a narrower and differently counted figure: never compare it with volumeUsd. */
  reportedSpotVolumeUsd?: number;
  /** Worked out from the day's own blocks. */
  networkHashrateHs?: number;
  difficulty?: number;
  blocks?: number;
  issuedCoins?: number;
  /**
   * What one block's coinbase paid out that day, read off the chain: its subsidy less any share
   * the protocol withholds, plus fees, superblocks excepted (DASH: the 80% after the treasury's).
   */
  coinbasePerBlockCoins?: number;
  feesCoins?: number;
  txCount?: number;
  /** USD value of the day's new coins. */
  issuedUsd?: number;
  priceBtc?: number;
  /** Market cap estimated with the source's own free-float method. */
  marketCapEstimatedUsd?: number;
  /** Market value to realized value. */
  mvrv?: number;
  /** Addresses active in the day. */
  activeAddresses?: number;
  /** Addresses holding a balance at the day's end. */
  addressesWithBalance?: number;
  /** Transfers of value (a transaction can make several). */
  transfers?: number;
  exchangeInflowCoins?: number;
  exchangeInflowUsd?: number;
  exchangeOutflowCoins?: number;
  exchangeOutflowUsd?: number;
  /** Coins held on exchanges at the day's end. */
  supplyOnExchangesCoins?: number;
  supplyOnExchangesUsd?: number;
  /** Supply expected 10 years from the day, by the emission schedule. */
  supplyExpected10yCoins?: number;
  /** Return over the 30 days to the day, in percent. */
  roi30dPct?: number;
  roi1yPct?: number;
}

/** What a source can answer; requests go only to sources that can. */
export interface CryptoCapabilities {
  /** Reports whole-market totals in its snapshot. */
  totals: boolean;
  /** Reports coins as they are now. */
  live: boolean;
  /** Reports complete past days. */
  history: boolean;
}

export interface CryptoProvider {
  readonly id: string;
  readonly costPerCall: number;
  readonly capabilities: CryptoCapabilities;
  readonly circuitBreaker?: boolean;
  readonly attemptTimeoutMs?: number;
  /** With `live` or `totals`. Coins the source does not know are left out, never an error. */
  snapshot?(req: SnapshotRequest, call: ProviderCall): Promise<CryptoSnapshot>;
  /**
   * Every coin the source knows, one per symbol, when it serves them all in one download
   * (miningpoolstats: one 258 KB table). The service then keeps the table for 5 minutes under
   * the source's own key and picks each call's coins from it with `pickCoins`, instead of
   * downloading it again for every new set of coins.
   */
  table?(call: ProviderCall): Promise<FoundLiveCoin[]>;
  /** With `history`. Coins or days the source does not have are left out. */
  history?(req: HistoryRequest, call: ProviderCall): Promise<FoundCoinDay[]>;
}

/** Larger market cap first, then more pools. */
const byMarketCap = (a: FoundLiveCoin, b: FoundLiveCoin) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0) || (b.pools ?? 0) - (a.pools ?? 0);

/** From a whole table: the coins asked for, or the `limit` largest by market cap (coins without one are not ranked). */
export function pickCoins(coins: FoundLiveCoin[], req: Pick<SnapshotRequest, "symbols" | "limit">): FoundLiveCoin[] {
  if (req.symbols) {
    const wanted = new Set(req.symbols.map((s) => s.toUpperCase()));
    return coins.filter((c) => wanted.has(c.symbol));
  }
  return coins
    .filter((c) => c.marketCapUsd !== undefined)
    .sort(byMarketCap)
    .slice(0, req.limit);
}

/** "2026-11-25T16:20:19.000Z" from Unix seconds. */
export const isoFromUnix = (seconds: number) => new Date(seconds * 1000).toISOString();
