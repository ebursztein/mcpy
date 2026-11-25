/**
 * Several sources report the same coin: their answers are merged field by
 * field, the first source in configured order that has a value winning.
 * The source behind each merged coin or day is kept for the host's usage log
 * (callers never see it).
 */

import type { CryptoSnapshot, FoundCoinDay, FoundLiveCoin, FoundTotals } from "../../providers/crypto-types.js";

/** A source's answer, tagged with the source that gave it. */
export interface Tagged<T> {
  provider: string;
  value: T;
}

export interface Merged<T> {
  value: T;
  /** The source of the first value merged in. */
  provider: string;
}

/** Copy into `into` every field it lacks; existing values stand. */
function fill<T extends object>(into: T, from: T): void {
  for (const [key, value] of Object.entries(from)) {
    if (value !== undefined && (into as Record<string, unknown>)[key] === undefined) (into as Record<string, unknown>)[key] = value;
  }
}

function mergeInto<T extends object>(map: Map<string, Merged<T>>, key: string, value: T, provider: string): void {
  const found = map.get(key);
  if (found) fill(found.value, value);
  else map.set(key, { value: { ...value }, provider });
}

/** Totals from the first source that had them; coins merged by symbol. */
export function mergeSnapshots(answers: Tagged<CryptoSnapshot>[]): { totals?: FoundTotals; coins: Map<string, Merged<FoundLiveCoin>> } {
  const coins = new Map<string, Merged<FoundLiveCoin>>();
  let totals: FoundTotals | undefined;
  for (const { provider, value } of answers) {
    if (value.totals) {
      if (totals) fill(totals, value.totals);
      else totals = { ...value.totals };
    }
    for (const coin of value.coins) mergeInto(coins, coin.symbol.toUpperCase(), { ...coin, symbol: coin.symbol.toUpperCase() }, provider);
  }
  return { totals, coins };
}

/** Days merged by symbol, then date. */
export function mergeHistories(answers: Tagged<FoundCoinDay[]>[], from: string, to: string): Map<string, Map<string, Merged<FoundCoinDay>>> {
  const bySymbol = new Map<string, Map<string, Merged<FoundCoinDay>>>();
  for (const { provider, value } of answers) {
    for (const day of value) {
      if (day.date < from || day.date > to) continue; // a source's stray day never reaches the caller
      const symbol = day.symbol.toUpperCase();
      const days = bySymbol.get(symbol) ?? new Map<string, Merged<FoundCoinDay>>();
      bySymbol.set(symbol, days);
      mergeInto(days, day.date, { ...day, symbol }, provider);
    }
  }
  return bySymbol;
}

/** The source behind most of these merged entries (ties: the first seen). */
export function mainSource(entries: Iterable<Merged<unknown>>): string | undefined {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.provider, (counts.get(e.provider) ?? 0) + 1);
  let best: string | undefined;
  for (const [provider, n] of counts) if (best === undefined || n > counts.get(best)!) best = provider;
  return best;
}
