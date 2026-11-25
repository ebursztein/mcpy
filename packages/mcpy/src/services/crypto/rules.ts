/**
 * What mcpy knows about a coin beyond any source: the share of new coins and
 * of fees its protocol leaves miners, the coin it is merge-mined with, and the
 * hashrate unit miners usually quote. Only coins listed here get miner fields
 * and hashprice; for any other coin those stay absent rather than guessed (a
 * dev fund or treasury would make a guess wrong). Carried over from deepmine's
 * coin registry (config/coins.json, checked there against production data),
 * 2026-11-25.
 */

import type { FoundCoinDay } from "../../providers/crypto-types.js";
import { HashrateUnit } from "../../schemas-crypto.js";

interface Step<T> {
  from: string;
  value: T;
}

interface MinerRule {
  /** Share of each block's subsidy that goes to its miner. */
  minerShare: number;
  /** Share of a block's fees its miner keeps, from each date; all of them before the first step. */
  feeShare?: Step<number>[];
  /**
   * Share of a block's coinbase payout its miner receives, for coins whose reported issuance is
   * not what blocks pay (DASH: the monthly treasury superblock sits inside it). The payout itself
   * is read off the chain (FoundCoinDay.coinbasePerBlockCoins), never scheduled.
   */
  coinbaseMinerShare?: number;
  /** Whether reported fees are the fees miners collect (DASH nets masternode payments out as negative fees; no source states KAS's). */
  feesReported: boolean;
  /** The coin whose work also mines this one (DOGE with LTC): a machine earns both. */
  mergeMinedWith?: string;
  /** The unit miners quote this coin's hashrate in, and its size in H/s (Sol/s for Equihash). */
  quoted: { unit: string; hs: number };
  /** Equihash coins count solutions, not hashes. */
  hashrateUnit?: HashrateUnit;
}

const TH = { unit: "TH/s", hs: 1e12 } as const;

const RULES: Record<string, MinerRule> = {
  BTC: { minerShare: 1, feesReported: true, quoted: TH },
  BCH: { minerShare: 1, feesReported: true, quoted: TH },
  LTC: { minerShare: 1, feesReported: true, quoted: TH },
  DOGE: { minerShare: 1, feesReported: true, quoted: TH, mergeMinedWith: "LTC" },
  XMR: { minerShare: 1, feesReported: true, quoted: { unit: "H/s", hs: 1 } },
  // Issuance includes uncle (ommer) rewards, which go to miners too.
  ETC: { minerShare: 1, feesReported: true, quoted: TH },
  // 20% of the subsidy funds development; since NU7 (2026-11-06) miners keep 40% of fees.
  ZEC: { minerShare: 0.8, feeShare: [{ from: "2026-11-06", value: 0.4 }], feesReported: true, quoted: { unit: "GSol/s", hs: 1e9 }, hashrateUnit: HashrateUnit.SolS },
  // Miners get 20% of new coins. A block's coinbase pays out the 80% left after the treasury's
  // share, and the miner's output is a quarter of it (live 2026-11-25: 0.41097067 of 1.64388266
  // at height 2,578,377; 0.44285466 of 1.77141863 at 2,500,000); masternodes and Platform's
  // credit pool get the rest.
  DASH: { minerShare: 0.2, coinbaseMinerShare: 0.25, feesReported: false, quoted: { unit: "GH/s", hs: 1e9 } },
  // Every new coin goes to the block's miner; the subsidy is read off each day's coinbases (the kaspa source). No source states its fees.
  KAS: { minerShare: 1, feesReported: false, quoted: TH },
};

function stepOn<T>(steps: Step<T>[] | undefined, day: string): T | undefined {
  let found: T | undefined;
  for (const s of steps ?? []) if (s.from <= day) found = s.value;
  return found;
}

/** Whether mcpy knows what this coin's miners receive. */
export const knowsMiners = (symbol: string) => symbol in RULES;

/** Miners' subsidy on a complete day, or undefined when it cannot be known. */
export function minerSubsidy(symbol: string, d: Pick<FoundCoinDay, "issuedCoins" | "blocks" | "coinbasePerBlockCoins">): number | undefined {
  const rule = RULES[symbol];
  if (!rule) return undefined;
  if (rule.coinbaseMinerShare !== undefined) {
    return d.coinbasePerBlockCoins !== undefined && d.blocks !== undefined ? d.coinbasePerBlockCoins * d.blocks * rule.coinbaseMinerShare : undefined;
  }
  return d.issuedCoins !== undefined ? d.issuedCoins * rule.minerShare : undefined;
}

/** Fees miners kept on a complete day, or undefined when it cannot be known. */
export function minerFees(symbol: string, day: string, feesCoins: number | undefined): number | undefined {
  const rule = RULES[symbol];
  if (!rule || !rule.feesReported || feesCoins === undefined) return undefined;
  return feesCoins * (stepOn(rule.feeShare, day) ?? 1);
}

/** Miners' share of coins issued over the last 24 hours (live days: fees not included). */
export function minerIssued(symbol: string, issuedCoins: number | undefined): number | undefined {
  const rule = RULES[symbol];
  return rule && issuedCoins !== undefined ? issuedCoins * rule.minerShare : undefined;
}

/** The coins a complete day's miners earned, for hashprice: subsidy plus fees, fees left out only where no source has them. */
export function minerEarned(symbol: string, subsidy: number | undefined, fees: number | undefined): number | undefined {
  const rule = RULES[symbol];
  if (!rule || subsidy === undefined) return undefined;
  if (!rule.feesReported) return subsidy;
  return fees === undefined ? undefined : subsidy + fees;
}

/** What mcpy states about a coin itself; undefined fields where it does not know. */
export function coinRule(symbol: string, day: string) {
  const rule = RULES[symbol];
  return {
    hashrateUnit: rule?.hashrateUnit,
    quotedUnit: rule?.quoted.unit,
    quotedUnitHs: rule?.quoted.hs,
    minerSharePct: rule ? rule.minerShare * 100 : undefined,
    minerFeeSharePct: rule && rule.feesReported ? (stepOn(rule.feeShare, day) ?? 1) * 100 : undefined,
    mergeMinedWith: rule?.mergeMinedWith,
  };
}

/** USD a day per H/s: price × coins miners earn ÷ hashrate, or undefined without all three. */
export function hashprice(priceUsd: number | undefined, minerCoins: number | undefined, hashrateHs: number | undefined): number | undefined {
  if (priceUsd === undefined || minerCoins === undefined || !hashrateHs) return undefined;
  return (priceUsd * minerCoins) / hashrateHs;
}
