/**
 * crypto_market: whole-market totals and many coins as they are now, from
 * every live source at once, merged by symbol. Cached for at least 5 minutes.
 */

import { sha256Hex } from "../../http/url.js";
import type { CallScope, Engine, Served } from "../../engine/engine.js";
import type { FoundLiveCoin, FoundTotals } from "../../providers/crypto-types.js";
import { cryptoMaxAgeOf, CryptoMarketResultSchema, HashrateUnit, MIN_CRYPTO_MAX_AGE_SECONDS, upperSymbols, type CryptoMarketQuery, type CryptoMarketResult, type MarketCoin } from "../../schemas-crypto.js";
import { mergeSnapshots } from "./merge.js";
import { coinRule, hashprice, minerIssued } from "./rules.js";
import { askSnapshots, noSources, sourcesFor } from "./sources.js";

const CACHE_KEY_VERSION = "v1";

export interface MarketAnswer {
  totals?: FoundTotals;
  coins: FoundLiveCoin[];
}

const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/** How much of the network the known pools account for, in percent; undefined without both figures. */
export function poolShare(c: Pick<FoundLiveCoin, "poolHashrateHs" | "networkHashrateHs">): number | undefined {
  return c.poolHashrateHs !== undefined && c.networkHashrateHs ? (c.poolHashrateHs / c.networkHashrateHs) * 100 : undefined;
}

/** Equihash-family coins count solutions; every other proof-of-work coin counts hashes. */
const unitOfAlgorithm = (algorithm: string | undefined): HashrateUnit | undefined =>
  algorithm === undefined ? undefined : /equihash|beamhash|zhash/i.test(algorithm) ? HashrateUnit.SolS : HashrateUnit.HS;

/** What the coin is, as a market row and a crypto.coin coin both state it: the sources' facts and mcpy's own registry. */
export function coinFacts(symbol: string, c: FoundLiveCoin | undefined, name?: string) {
  const rule = coinRule(symbol, new Date().toISOString().slice(0, 10));
  return compact({
    symbol,
    name: c?.name ?? name ?? symbol,
    algorithm: c?.algorithm,
    mined_with: c?.minedWith,
    block_time_target_s: c?.blockTimeTargetS,
    block_height: c?.blockHeight,
    hashrate_unit: c?.hashrateUnit ?? rule.hashrateUnit ?? (rule.quotedUnit ? HashrateUnit.HS : unitOfAlgorithm(c?.algorithm)),
    quoted_hashrate_unit: rule.quotedUnit,
    quoted_hashrate_unit_hs: rule.quotedUnitHs,
    miner_share_pct: rule.minerSharePct,
    miner_fee_share_pct: rule.minerFeeSharePct,
    merge_mined_with: rule.mergeMinedWith,
  });
}

/** A coin's figures now: a market row's and a live day's, field for field. */
export function nowFigures(c: FoundLiveCoin) {
  return compact({
    price_usd: c.priceUsd,
    price_change_24h_pct: c.priceChange24hPct,
    price_change_7d_pct: c.priceChange7dPct,
    high_24h_usd: c.high24hUsd,
    low_24h_usd: c.low24hUsd,
    all_time_high_usd: c.allTimeHighUsd,
    all_time_high_date: c.allTimeHighDate,
    market_cap_usd: c.marketCapUsd,
    market_cap_rank: c.marketCapRank,
    fully_diluted_value_usd: c.fullyDilutedValueUsd,
    volume_24h_usd: c.volume24hUsd,
    supply: c.supply,
    total_supply: c.totalSupply,
    max_supply: c.maxSupply,
    network_hashrate_hs: c.networkHashrateHs,
    difficulty: c.difficulty,
    difficulty_change_7d_pct: c.difficultyChange7dPct,
    block_time_s: c.blockTimeS,
    pools: c.pools,
    pool_hashrate_hs: c.poolHashrateHs,
    pool_share_pct: poolShare(c),
    issued_24h_coins: c.issued24hCoins,
    hashprice_usd_per_hs_day: hashprice(c.priceUsd, minerIssued(c.symbol, c.issued24hCoins), c.networkHashrateHs),
  });
}

/** A merged live coin as a market row. */
export function marketRow(c: FoundLiveCoin): MarketCoin {
  return { ...coinFacts(c.symbol, c), ...nowFigures(c), as_of: c.asOf };
}

/** Coins in the order asked, else the largest market caps first; `missing` lists asked-for symbols nobody had. */
export function pickCoins(coins: FoundLiveCoin[], symbols: string[] | undefined, limit: number): { coins: FoundLiveCoin[]; missing: string[] } {
  if (symbols) {
    const bySymbol = new Map(coins.map((c) => [c.symbol, c]));
    return { coins: symbols.flatMap((s) => (bySymbol.has(s) ? [bySymbol.get(s)!] : [])), missing: symbols.filter((s) => !bySymbol.has(s)) };
  }
  const ranked = [...coins].sort((a, b) => (b.marketCapUsd ?? -1) - (a.marketCapUsd ?? -1));
  return { coins: ranked.slice(0, limit), missing: [] };
}

export async function cryptoMarketOp(
  engine: Engine,
  input: CryptoMarketQuery,
  scope: CallScope,
): Promise<{ result: CryptoMarketResult; served: Served<unknown>; outputChars: number }> {
  const startedAt = Date.now();
  const providers = sourcesFor(engine, "live");
  if (!providers.length) throw noSources("market data");
  const symbols = input.symbols ? upperSymbols(input.symbols) : undefined;
  const key = `${CACHE_KEY_VERSION}:crypto:market:${await sha256Hex(JSON.stringify([symbols ? [...symbols].sort() : null, input.limit]))}`;
  const served = await engine.cached<MarketAnswer>(key, () => MIN_CRYPTO_MAX_AGE_SECONDS, cryptoMaxAgeOf(input.max_age), scope, async (deadlineAt) => {
    const asked = await askSnapshots(engine, providers, { symbols, limit: input.limit, totals: true }, deadlineAt, scope, cryptoMaxAgeOf(input.max_age));
    const merged = mergeSnapshots(asked.value);
    return { ...asked, value: { totals: merged.totals, coins: [...merged.coins.values()].map((m) => m.value) } };
  });
  const picked = pickCoins(served.value.coins, symbols, input.limit);
  const totals = served.value.totals;
  const result = CryptoMarketResultSchema.parse(
    compact({
      as_of: new Date().toISOString(),
      total_market_cap_usd: totals?.totalMarketCapUsd,
      total_volume_24h_usd: totals?.totalVolume24hUsd,
      btc_dominance_pct: totals?.btcDominancePct,
      total_market_cap_change_24h_pct: totals?.totalMarketCapChange24hPct,
      active_coins: totals?.activeCoins,
      markets: totals?.markets,
      coins: picked.coins.map(marketRow),
      missing: picked.missing,
      meta: { cache: served.cache, latency_ms: Date.now() - startedAt, attempts: served.attempts },
    }),
  );
  return { result, served, outputChars: JSON.stringify(result.coins).length };
}
