/**
 * crypto_coin: a few coins day by day. Complete days come from the history
 * sources, today from the live ones, both asked at once and merged by symbol
 * and date. Miners' shares and hashprice are worked out here (rules.ts).
 * The source behind each coin's complete and live days goes to the host's
 * usage log as the call's parts, never to the caller.
 */

import type { ChainResult } from "../../engine/chain.js";
import type { CallScope, Engine, Served } from "../../engine/engine.js";
import { sha256Hex } from "../../http/url.js";
import type { FoundCoinDay, FoundLiveCoin } from "../../providers/crypto-types.js";
import { CoinDayStatus, coinWindow, cryptoMaxAgeOf, CryptoCoinResultSchema, MIN_CRYPTO_MAX_AGE_SECONDS, upperSymbols, type Coin, type CoinDay, type CryptoCoinQuery, type CryptoCoinResult } from "../../schemas-crypto.js";
import { blockIssuance, lacksIssuance, minerPerBlockOf } from "./issuance.js";
import { mergeHistories, mergeSnapshots, sourcesOf, type Merged } from "./merge.js";
import { coinFacts, nowFigures } from "./market.js";
import { hashprice, minerEarned, minerFees, minerSubsidy } from "./rules.js";
import { askHistories, askSnapshots, noSources, sourcesFor } from "./sources.js";

const CACHE_KEY_VERSION = "v3";
const DAY_MS = 86_400_000;
/** Complete days are final once their sources have published them: a window ending this long ago is kept a day. */
const SETTLED_AFTER_DAYS = 2;
const SETTLED_TTL_SECONDS = 86_400;

export interface CoinAnswer {
  coins: Coin[];
  missing: string[];
  /** Every source behind "<SYMBOL> complete" / "<SYMBOL> live", for the usage log. */
  parts: Record<string, string>;
}

const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function completeDay(d: FoundCoinDay): CoinDay {
  const subsidy = minerSubsidy(d.symbol, d);
  const fees = minerFees(d.symbol, d.date, d.feesCoins);
  return compact({
    date: d.date,
    status: CoinDayStatus.Complete,
    price_usd: d.priceUsd,
    market_cap_usd: d.marketCapUsd,
    supply: d.supply,
    volume_24h_usd: d.volumeUsd,
    reported_spot_volume_usd: d.reportedSpotVolumeUsd,
    network_hashrate_hs: d.networkHashrateHs,
    difficulty: d.difficulty,
    blocks: d.blocks,
    issued_24h_coins: d.issuedCoins,
    fees_coins: d.feesCoins,
    tx_count: d.txCount,
    issued_24h_usd: d.issuedUsd,
    price_btc: d.priceBtc,
    market_cap_estimated_usd: d.marketCapEstimatedUsd,
    mvrv: d.mvrv,
    active_addresses: d.activeAddresses,
    addresses_with_balance: d.addressesWithBalance,
    transfers: d.transfers,
    exchange_inflow_coins: d.exchangeInflowCoins,
    exchange_inflow_usd: d.exchangeInflowUsd,
    exchange_outflow_coins: d.exchangeOutflowCoins,
    exchange_outflow_usd: d.exchangeOutflowUsd,
    supply_on_exchanges_coins: d.supplyOnExchangesCoins,
    supply_on_exchanges_usd: d.supplyOnExchangesUsd,
    supply_expected_10y_coins: d.supplyExpected10yCoins,
    roi_30d_pct: d.roi30dPct,
    roi_1y_pct: d.roi1yPct,
    miner_subsidy_coins: subsidy,
    miner_fees_coins: fees,
    hashprice_usd_per_hs_day: hashprice(d.priceUsd, minerEarned(d.symbol, subsidy, fees), d.networkHashrateHs),
  });
}

/** Today, with exactly a market row's figures; `minerPerBlock` as for nowFigures. */
export function liveDay(c: FoundLiveCoin, today: string, minerPerBlock?: number): CoinDay {
  return { date: today, status: CoinDayStatus.Live, as_of: c.asOf, ...nowFigures(c, minerPerBlock) };
}

/** One coin's output from its merged days and live reading; undefined when no source knew it. */
export function coinOf(
  symbol: string,
  days: Map<string, Merged<FoundCoinDay>> | undefined,
  live: FoundLiveCoin | undefined,
  today: string,
  minerPerBlock?: number,
): Coin | undefined {
  const complete = [...(days?.values() ?? [])].map((m) => m.value).sort((a, b) => a.date.localeCompare(b.date));
  if (!complete.length && !live) return undefined;
  return compact({
    ...coinFacts(symbol, live, complete.find((d) => d.name)?.name),
    days: [...complete.map(completeDay), ...(live ? [liveDay(live, today, minerPerBlock)] : [])],
  });
}

/** Run the two parts that apply; one part failing leaves the other's days, both failing fails the call. */
async function both<A, B>(a: Promise<ChainResult<A>> | undefined, b: Promise<ChainResult<B>> | undefined): Promise<{ a?: A; b?: B; attempts: ChainResult<unknown>["attempts"]; costUsd: number; provider: string }> {
  const settled = await Promise.allSettled([a ?? Promise.resolve(undefined), b ?? Promise.resolve(undefined)]);
  const ok = settled.flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));
  if (!ok.length) throw settled.find((s): s is PromiseRejectedResult => s.status === "rejected")!.reason;
  const value = (i: number) => (settled[i].status === "fulfilled" ? (settled[i] as PromiseFulfilledResult<ChainResult<never> | undefined>).value?.value : undefined);
  return { a: value(0), b: value(1), attempts: ok.flatMap((r) => r.attempts), costUsd: ok.reduce((n, r) => n + r.costUsd, 0), provider: ok.map((r) => r.provider).join("+") };
}

export async function cryptoCoinOp(
  engine: Engine,
  input: CryptoCoinQuery,
  scope: CallScope,
): Promise<{ result: CryptoCoinResult; served: Served<unknown>; outputChars: number }> {
  const startedAt = Date.now();
  const today = dayOf(Date.now());
  const { from, to } = coinWindow(input);
  const symbols = upperSymbols(input.symbols);
  const wantsLive = to === today;
  const lastComplete = wantsLive ? dayOf(Date.now() - DAY_MS) : to;
  const wantsHistory = from <= lastComplete;
  const live = wantsLive ? sourcesFor(engine, "live") : [];
  const history = wantsHistory ? sourcesFor(engine, "history") : [];
  if (!live.length && !history.length) throw noSources(wantsHistory ? "past days" : "coin data");

  const key = `${CACHE_KEY_VERSION}:crypto:coin:${await sha256Hex(JSON.stringify([symbols, from, to]))}`;
  const settled = Date.now() - Date.parse(to) > SETTLED_AFTER_DAYS * DAY_MS;
  const ttl = () => (settled ? SETTLED_TTL_SECONDS : MIN_CRYPTO_MAX_AGE_SECONDS);
  const served = await engine.cached<CoinAnswer>(key, ttl, cryptoMaxAgeOf(input.max_age), scope, async (deadlineAt) => {
    const req = { symbols, limit: symbols.length, totals: false };
    const run = await both(
      live.length ? askSnapshots(engine, live, req, deadlineAt, scope, cryptoMaxAgeOf(input.max_age)) : undefined,
      history.length ? askHistories(engine, history, { symbols, from, to: lastComplete }, deadlineAt, scope) : undefined,
    );
    const snapshots = mergeSnapshots(run.a ?? []);
    const histories = mergeHistories(run.b ?? [], from, lastComplete);
    // Coins per block for a live day whose issuance no source states: from the window's own days when it has them, else asked for.
    const needing = [...snapshots.coins.values()].map((m) => m.value).filter(lacksIssuance);
    const minerPerBlock: Record<string, number> = {};
    for (const c of needing) {
      const found = minerPerBlockOf(c.symbol, [...(histories.get(c.symbol)?.values() ?? [])].map((m) => m.value));
      if (found !== undefined) minerPerBlock[c.symbol] = found;
    }
    const issuance = await blockIssuance(engine, needing.map((c) => c.symbol).filter((s) => !(s in minerPerBlock)), deadlineAt, scope);
    Object.assign(minerPerBlock, issuance?.value.minerPerBlock);
    const parts: Record<string, string> = {};
    const coins: Coin[] = [];
    const missing: string[] = [];
    for (const symbol of symbols) {
      const days = histories.get(symbol);
      const now = snapshots.coins.get(symbol);
      const coin = coinOf(symbol, days, now?.value, today, minerPerBlock[symbol]);
      if (!coin) {
        missing.push(symbol);
        continue;
      }
      coins.push(coin);
      const source = days ? sourcesOf(days.values()) : undefined;
      if (source) parts[`${symbol} complete`] = source;
      const estimatedBy = issuance?.value.sources[symbol];
      if (now) parts[`${symbol} live`] = [...now.sources, ...(estimatedBy && !now.sources.includes(estimatedBy) ? [estimatedBy] : [])].join("+");
    }
    return {
      value: { coins, missing, parts },
      attempts: [...run.attempts, ...(issuance?.attempts ?? [])],
      costUsd: run.costUsd + (issuance?.costUsd ?? 0),
      provider: issuance ? `${run.provider}+${issuance.provider}` : run.provider,
      salvaged: false,
    };
  });
  const result = CryptoCoinResultSchema.parse({
    coins: served.value.coins,
    missing: served.value.missing,
    meta: { cache: served.cache, latency_ms: Date.now() - startedAt, attempts: served.attempts },
  });
  return { result, served: { ...served, parts: served.value.parts }, outputChars: JSON.stringify(result.coins).length };
}
