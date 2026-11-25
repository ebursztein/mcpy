/**
 * Block figures from the chain's own data, never from a schedule or a constant
 * (owner, 2026-11-25). Some live sources state no 24-hour issuance for a coin
 * (ZEC, DASH: miningpoolstats has none), which leaves its live hashprice
 * unknown. The latest complete day the history sources have gives the coins
 * its miners received per block (rules.ts: ZEC 80% of issuance, DASH a quarter
 * of the coinbase payout); times 86,400 ÷ the live block time, that is what
 * miners received over the last 24 hours. A change in the block reward (a halving, an upgrade like NU7)
 * reaches the estimate a day late.
 */

import type { ChainResult } from "../../engine/chain.js";
import type { CallScope, Engine } from "../../engine/engine.js";
import type { FoundCoinDay, FoundLiveCoin } from "../../providers/crypto-types.js";
import { mergeHistories, sourcesOf } from "./merge.js";
import { knowsMiners, minerSubsidy } from "./rules.js";
import { askHistories, sourcesFor } from "./sources.js";

const DAY_MS = 86_400_000;
/** Days back to look for a published day: yesterday is not always out yet. */
const LOOKBACK_DAYS = 3;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Coins miners received per block on each coin's latest day that states it, and the sources behind it (for the usage log). */
export interface BlockIssuance {
  minerPerBlock: Record<string, number>;
  sources: Record<string, string>;
}

/** The coin's miners' subsidy per block on the latest of these days that has it; undefined when none does. */
export function minerPerBlockOf(symbol: string, days: Iterable<FoundCoinDay>): number | undefined {
  let found: { date: string; value: number } | undefined;
  for (const d of days) {
    const subsidy = d.blocks ? minerSubsidy(symbol, d) : undefined;
    if (subsidy && (!found || d.date > found.date)) found = { date: d.date, value: subsidy / d.blocks! };
  }
  return found?.value;
}

/** Coins over the last 24 hours from coins per block and the live block time; undefined without both. */
export function coinsAtBlockTime(perBlock: number | undefined, blockTimeS: number | undefined): number | undefined {
  return perBlock !== undefined && blockTimeS ? (perBlock * 86_400) / blockTimeS : undefined;
}

/** A live coin whose hashprice needs the estimate: its miners' share is known, its block time measured, its issuance unstated. */
export const lacksIssuance = (c: FoundLiveCoin) => knowsMiners(c.symbol) && c.issued24hCoins === undefined && c.blockTimeS !== undefined;

/**
 * Coins per block for these symbols from the history sources' last few complete days.
 * Undefined when there is nothing to ask or no history source; a failure is
 * undefined too, since the live figures stand without it.
 */
export async function blockIssuance(engine: Engine, symbols: string[], deadlineAt: number, scope: CallScope): Promise<ChainResult<BlockIssuance> | undefined> {
  const providers = sourcesFor(engine, "history");
  if (!symbols.length || !providers.length) return undefined;
  const to = dayOf(Date.now() - DAY_MS);
  const from = dayOf(Date.now() - LOOKBACK_DAYS * DAY_MS);
  const asked = await askHistories(engine, providers, { symbols, from, to }, deadlineAt, scope).catch(() => undefined);
  if (!asked) return undefined;
  const minerPerBlock: Record<string, number> = {};
  const sources: Record<string, string> = {};
  for (const [symbol, days] of mergeHistories(asked.value, from, to)) {
    const value = minerPerBlockOf(symbol, [...days.values()].map((m) => m.value));
    if (value === undefined) continue;
    minerPerBlock[symbol] = value;
    const by = sourcesOf(days.values());
    if (by) sources[symbol] = by;
  }
  return { ...asked, value: { minerPerBlock, sources } };
}
