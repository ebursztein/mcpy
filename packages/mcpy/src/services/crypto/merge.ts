/**
 * Several sources report the same coin: their answers are merged field by
 * field, the first source in configured order that has a value winning.
 * Every source that supplied at least one field of a merged coin or day is
 * kept, in order, for the host's usage log (callers never see it).
 */

import type { CryptoSnapshot, FoundCoinDay, FoundLiveCoin, FoundTotals } from "../../providers/crypto-types.js";

/** A source's answer, tagged with the source that gave it. */
export interface Tagged<T> {
  provider: string;
  value: T;
}

export interface Merged<T> {
  value: T;
  /** Every source that supplied at least one field, first one first. */
  sources: string[];
}

/** Copy into `into` every field it lacks; existing values stand. True when anything was copied. */
function fill<T extends object>(into: T, from: T): boolean {
  let filled = false;
  for (const [key, value] of Object.entries(from)) {
    if (value !== undefined && (into as Record<string, unknown>)[key] === undefined) {
      (into as Record<string, unknown>)[key] = value;
      filled = true;
    }
  }
  return filled;
}

function mergeInto<T extends object>(map: Map<string, Merged<T>>, key: string, value: T, provider: string): void {
  const found = map.get(key);
  if (!found) map.set(key, { value: { ...value }, sources: [provider] });
  else if (fill(found.value, value) && !found.sources.includes(provider)) found.sources.push(provider);
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

/** Every source behind these merged entries, in the order they first appear, joined for the log ("coinmetrics+kaspa"). */
export function sourcesOf(entries: Iterable<Merged<unknown>>): string | undefined {
  const all: string[] = [];
  for (const e of entries) for (const s of e.sources) if (!all.includes(s)) all.push(s);
  return all.length ? all.join("+") : undefined;
}
