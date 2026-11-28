/**
 * crypto_market: whole-market totals and many coins as they are now, from
 * every live source at once, merged by symbol. Cached for at least 5 minutes.
 */

import { hashedId } from "../../cache/shared.js";
import { z } from "zod";
import { cacheSpace, CacheName, requiredFields } from "../../cache/spaces.js";
import type { CallScope, Engine, Served } from "../../engine/engine.js";
import type { FoundLiveCoin, FoundTotals } from "../../providers/crypto-types.js";
import { cryptoMaxAgeOf, CryptoMarketResultSchema, HashrateUnit, MIN_CRYPTO_MAX_AGE_SECONDS, upperSymbols, type CryptoMarketQuery, type CryptoMarketResult, type MarketCoin } from "../../schemas-crypto.js";
import { blockIssuance, coinsAtBlockTime, lacksIssuance } from "./issuance.js";
import { mergeSnapshots } from "./merge.js";
import { coinRule, hashprice, minerIssued } from "./rules.js";
import { askSnapshots, FoundLiveCoinSchema, noSources, sourcesFor } from "./sources.js";

export interface MarketAnswer {
  totals?: FoundTotals;
  coins: FoundLiveCoin[];
  /** Coins miners received per block lately, for coins whose live sources state no issuance (issuance.ts). */
  minerPerBlock?: Record<string, number>;
}

const MarketSpace = cacheSpace(
  CacheName.CryptoMarket,
  requiredFields<MarketAnswer>({
    totals: requiredFields<FoundTotals>({ asOf: z.string(), totalMarketCapUsd: z.number() }).optional(),
    coins: z.array(FoundLiveCoinSchema()),
    minerPerBlock: z.record(z.string(), z.number()).optional(),
  }),
);

const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/** How much of the network the known pools account for, in percent; undefined without both figures. */
export function poolShare(c: Pick<FoundLiveCoin, "poolHashrateHs" | "networkHashrateHs">): number | undefined {
  return c.poolHashrateHs !== undefined && c.networkHashrateHs ? (c.poolHashrateHs / c.networkHashrateHs) * 100 : undefined;
}

/**
 * How far a measured block time may sit from a stated target before the target is taken as stale.
 * Difficulty retargeting holds a live chain near its target; live 2026-11-25, a source's targets
 * were off by 3x or more where the protocol had changed (ZEC 75 s against 25.1 s measured after
 * NU7's 25 s; KAS 1 s against 0.1 s after Crescendo; ALPH, ALEO).
 */
const TARGET_TOLERANCE = 2;

/** The source's block time target when the measured block time bears it out; undefined when stale or unchecked. */
export function measuredTarget(targetS: number | undefined, blockTimeS: number | undefined): number | undefined {
  if (targetS === undefined || !blockTimeS) return undefined;
  const ratio = blockTimeS / targetS;
  return ratio <= TARGET_TOLERANCE && ratio >= 1 / TARGET_TOLERANCE ? targetS : undefined;
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
    block_time_target_s: measuredTarget(c?.blockTimeTargetS, c?.blockTimeS),
    block_height: c?.blockHeight,
    hashrate_unit: c?.hashrateUnit ?? rule.hashrateUnit ?? (rule.quotedUnit ? HashrateUnit.HS : unitOfAlgorithm(c?.algorithm)),
    quoted_hashrate_unit: rule.quotedUnit,
    quoted_hashrate_unit_hs: rule.quotedUnitHs,
    miner_share_pct: rule.minerSharePct,
    miner_fee_share_pct: rule.minerFeeSharePct,
    merge_mined_with: rule.mergeMinedWith,
  });
}

/**
 * A coin's figures now: a market row's and a live day's, field for field. Hashprice takes the
 * miners' share of the issuance the sources state, else what miners received per block lately ×
 * blocks a day at the live block time.
 */
export function nowFigures(c: FoundLiveCoin, minerPerBlock?: number) {
  const minerCoins = c.issued24hCoins !== undefined ? minerIssued(c.symbol, c.issued24hCoins) : coinsAtBlockTime(minerPerBlock, c.blockTimeS);
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
    hashprice_usd_per_hs_day: hashprice(c.priceUsd, minerCoins, c.networkHashrateHs),
  });
}

/** A merged live coin as a market row. */
export function marketRow(c: FoundLiveCoin, minerPerBlock?: number): MarketCoin {
  return { ...coinFacts(c.symbol, c), ...nowFigures(c, minerPerBlock), as_of: c.asOf };
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
  const id = await hashedId([symbols ? [...symbols].sort() : null, input.limit]);
  const served = await engine.cached(MarketSpace, id, () => MIN_CRYPTO_MAX_AGE_SECONDS, cryptoMaxAgeOf(input.max_age), scope, async (deadlineAt) => {
    const asked = await askSnapshots(engine, providers, { symbols, limit: input.limit, totals: true }, deadlineAt, scope, cryptoMaxAgeOf(input.max_age));
    const merged = mergeSnapshots(asked.value);
    const coins = [...merged.coins.values()].map((m) => m.value);
    const shown = pickCoins(coins, symbols, input.limit).coins;
    const issuance = await blockIssuance(engine, shown.filter(lacksIssuance).map((c) => c.symbol), deadlineAt, scope);
    return {
      ...asked,
      value: { totals: merged.totals, coins, minerPerBlock: issuance?.value.minerPerBlock },
      attempts: [...asked.attempts, ...(issuance?.attempts ?? [])],
      costUsd: asked.costUsd + (issuance?.costUsd ?? 0),
      provider: issuance ? `${asked.provider}+${issuance.provider}` : asked.provider,
    };
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
      coins: picked.coins.map((c) => marketRow(c, served.value.minerPerBlock?.[c.symbol])),
      missing: picked.missing,
      meta: { cache: served.cache, latency_ms: Date.now() - startedAt, attempts: served.attempts },
    }),
  );
  return { result, served, outputChars: JSON.stringify(result.coins).length };
}
