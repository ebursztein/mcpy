/**
 * What mcpy knows about a coin beyond any source: the share of new coins and
 * of fees its protocol leaves miners, the coin it is merge-mined with, and the
 * hashrate unit miners usually quote. Only coins listed here get miner fields
 * and hashprice; for any other coin those stay absent rather than guessed (a
 * dev fund or treasury would make a guess wrong). Carried over from deepmine's
 * coin registry (config/coins.json, checked there against production data),
 * 2026-11-25.
 */

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
   * The subsidy a block by the emission schedule, for coins whose reported
   * issuance is not the block subsidy (DASH: the monthly treasury superblock
   * sits inside its issuance).
   */
  scheduledSubsidy?: Step<number>[];
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
  // Miners get 20% of the block reward; masternodes and the treasury the rest.
  DASH: {
    minerShare: 0.2,
    scheduledSubsidy: [
      { from: "2026-08-17", value: 1.8479 },
      { from: "2027-09-04", value: 1.71590714 },
      { from: "2028-09-21", value: 1.59334235 },
    ],
    feesReported: false,
    quoted: { unit: "GH/s", hs: 1e9 },
  },
  // The block reward falls every month by schedule; no source reports Kaspa's issuance or fees.
  KAS: {
    minerShare: 1,
    scheduledSubsidy: [
      { from: "2026-09-04", value: 2.18267645 },
      { from: "2026-10-05", value: 2.06017223 },
      { from: "2026-11-04", value: 1.94454365 },
      { from: "2026-12-05", value: 1.8354048 },
      { from: "2027-01-04", value: 1.73239145 },
      { from: "2027-02-03", value: 1.63515979 },
      { from: "2027-03-06", value: 1.54338532 },
      { from: "2027-04-05", value: 1.45676176 },
      { from: "2027-05-06", value: 1.375 },
      { from: "2027-06-05", value: 1.29782718 },
      { from: "2027-07-06", value: 1.22498574 },
      { from: "2027-08-05", value: 1.15623257 },
      { from: "2027-09-04", value: 1.09133823 },
      { from: "2027-10-05", value: 1.03008612 },
      { from: "2027-11-04", value: 0.97227183 },
      { from: "2027-12-05", value: 0.9177024 },
      { from: "2028-01-04", value: 0.86619572 },
      { from: "2028-02-04", value: 0.81757989 },
      { from: "2028-03-05", value: 0.77169266 },
      { from: "2028-04-05", value: 0.72838088 },
      { from: "2028-05-05", value: 0.6875 },
      { from: "2028-06-04", value: 0.64891359 },
      { from: "2028-07-05", value: 0.61249287 },
      { from: "2028-08-04", value: 0.57811629 },
      { from: "2028-09-04", value: 0.54566911 },
      { from: "2028-10-04", value: 0.51504306 },
      { from: "2028-11-04", value: 0.48613591 },
      { from: "2028-12-04", value: 0.4588512 },
      { from: "2029-01-03", value: 0.43309786 },
      { from: "2029-02-03", value: 0.40878995 },
      { from: "2029-03-05", value: 0.38584633 },
      { from: "2029-04-05", value: 0.36419044 },
      { from: "2029-05-05", value: 0.34375 },
      { from: "2029-06-05", value: 0.3244568 },
      { from: "2029-07-05", value: 0.30624643 },
      { from: "2029-08-05", value: 0.28905814 },
      { from: "2029-09-04", value: 0.27283456 },
      { from: "2029-10-04", value: 0.25752153 },
      { from: "2029-11-04", value: 0.24306796 },
      { from: "2029-12-04", value: 0.2294256 },
      { from: "2030-01-04", value: 0.21654893 },
    ],
    feesReported: false,
    quoted: TH,
  },
};

function stepOn<T>(steps: Step<T>[] | undefined, day: string): T | undefined {
  let found: T | undefined;
  for (const s of steps ?? []) if (s.from <= day) found = s.value;
  return found;
}

/** Whether mcpy knows what this coin's miners receive. */
export const knowsMiners = (symbol: string) => symbol in RULES;

/** Miners' subsidy on a complete day, or undefined when it cannot be known. */
export function minerSubsidy(symbol: string, day: string, issuedCoins: number | undefined, blocks: number | undefined): number | undefined {
  const rule = RULES[symbol];
  if (!rule) return undefined;
  if (rule.scheduledSubsidy) {
    const perBlock = stepOn(rule.scheduledSubsidy, day);
    return perBlock !== undefined && blocks !== undefined ? perBlock * blocks * rule.minerShare : undefined;
  }
  return issuedCoins !== undefined ? issuedCoins * rule.minerShare : undefined;
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
