import { ErrorCode } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { HashrateUnit, MiningHardware } from "../../schemas-crypto.js";
import { isoFromUnix, pickCoins, type CryptoCapabilities, type CryptoProvider, type FoundLiveCoin, type SnapshotRequest } from "../crypto-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { CoinRowSchema, CoinsDataSchema, looseNumber, type CoinRow } from "./schemas.js";

export interface MiningPoolStatsOptions {
  costPerCall?: number;
}

const HOME = "https://miningpoolstats.stream/";
/**
 * The coin table the homepage loads. The server answers 403 unless `t` is
 * the exact value the homepage embeds (verified live 2026-11-25: a guessed
 * current time, or no `t`, is refused), so the homepage is read first.
 */
const DATA_LINK = /https:\/\/server\.miningpoolstats\.stream\/data\/coins_data\.js\?t=\d+/;

export const MINING_POOL_STATS_CAPABILITIES: CryptoCapabilities = { totals: false, live: true, history: false };

/** The coin table's URL as the homepage links it, or undefined. */
export function coinsDataUrl(html: string): string | undefined {
  return DATA_LINK.exec(html)?.[0];
}

const SI_PREFIX: Record<string, number> = { "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };
/** "H/s", "KH/s", "Sol/s", "MSol/s"... */
const HASH_UNIT = /^([kKMGTPE]?)(H|Sol)\/s$/;

/**
 * A hashrate in H/s (Sol/s for Equihash-family coins, as the public schema
 * states them), or undefined for a unit that is not a hash rate. Seen live
 * 2026-11-25: H/s (460 rows), Sol/s (22: Equihash variants and BeamHash),
 * and units of other work that do not convert: Gps (Cuckoo graphs), B/s,
 * c/s, It/s, iB and H (storage-proof coins).
 */
export function hashesPerSecond(value: number | null | undefined, unit: string | null | undefined): number | undefined {
  const match = unit ? HASH_UNIT.exec(unit.trim()) : null;
  if (!match || !positive(value)) return undefined;
  return value * (SI_PREFIX[match[1]] ?? 1);
}

/** H/s or Sol/s from the row's unit ("GH/s", "Sol/s"); undefined for anything else (Gps, iB...). */
export function hashrateUnitOf(unit: string | null | undefined): HashrateUnit | undefined {
  const match = unit ? HASH_UNIT.exec(unit.trim()) : null;
  return match ? (match[2] === "Sol" ? HashrateUnit.SolS : HashrateUnit.HS) : undefined;
}

const HARDWARE: Record<string, MiningHardware> = { ASIC: MiningHardware.Asic, GPU: MiningHardware.Gpu, CPU: MiningHardware.Cpu };

/** ASIC, GPU or CPU; anything else (HDD, "") says nothing about the hardware enum. */
export function hardwareOf(typ: string | null | undefined): MiningHardware | undefined {
  return typ ? HARDWARE[typ.trim().toUpperCase()] : undefined;
}

/**
 * Percent change in difficulty over `diff7`, oldest to newest positive value;
 * undefined with fewer than two. diff7 runs oldest first: its last value is
 * the one nearest the row's current `diff` (live 2026-11-25: on 310 of 418
 * rows, against 75 for the first; e.g. KAS diff 1.567e16, diff7 1.597e16 ...
 * 1.574e16; XMR diff 7.63e11, diff7 8.42e11 ... 7.74e11).
 */
export function difficultyChange7dPct(diff7: unknown[] | null | undefined): number | undefined {
  const values = (diff7 ?? []).flatMap((v) => {
    const parsed = looseNumber.safeParse(v);
    return parsed.success && positive(parsed.data) ? [parsed.data] : [];
  });
  if (values.length < 2) return undefined;
  const [first, last] = [values[0], values[values.length - 1]];
  return ((last - first) / first) * 100;
}

const positive = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const ifPositive = (v: number | null | undefined) => (positive(v) ? v : undefined);
const nonEmpty = (s: string | null | undefined) => (s?.trim() ? s.trim() : undefined);

/**
 * One coin as the table states it. Zero stands for "unknown" throughout the
 * table (210 rows have a 24h volume of 0, e24 is -1 when unknown), so only
 * positive figures are reported; a 7-day change is reported only with a price.
 * Undefined when the row has no reading time.
 */
export function toLiveCoin(row: CoinRow, fileTime?: number | null): FoundLiveCoin | undefined {
  const time = ifPositive(row.time) ?? ifPositive(fileTime);
  if (time === undefined) return undefined;
  const priceUsd = ifPositive(row.pr);
  const height = ifPositive(row.height);
  const pools = ifPositive(row.pools);
  return {
    symbol: row.symbol.trim().toUpperCase(),
    name: nonEmpty(row.name),
    asOf: isoFromUnix(time),
    algorithm: nonEmpty(row.algo),
    minedWith: hardwareOf(row.typ),
    blockTimeTargetS: ifPositive(row.target),
    blockHeight: height !== undefined && Number.isInteger(height) ? height : undefined,
    priceUsd,
    priceChange7dPct: priceUsd !== undefined && typeof row.c7d === "number" ? row.c7d : undefined,
    marketCapUsd: ifPositive(row.mc),
    volume24hUsd: ifPositive(row.v24),
    networkHashrateHs: hashesPerSecond(row.hashrate, row.unit),
    hashrateUnit: hashesPerSecond(row.hashrate, row.unit) !== undefined ? hashrateUnitOf(row.unit) : undefined,
    // No hashrateChange7dPct: diff7 is difficulty, and the table has no hashrate series.
    difficulty: ifPositive(row.diff),
    difficultyChange7dPct: difficultyChange7dPct(row.diff7),
    blockTimeS: ifPositive(row.bt),
    issued24hCoins: ifPositive(row.e24),
    pools: pools !== undefined && Number.isInteger(pools) ? pools : undefined,
    poolHashrateHs: hashesPerSecond(row.ph, row.unit),
  };
}

/** Larger market cap first, then more pools: picks the main row when several share a symbol. */
const rank = (a: FoundLiveCoin, b: FoundLiveCoin) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0) || (b.pools ?? 0) - (a.pools ?? 0);

/**
 * Every valid row as a coin, one per symbol. Several rows can share a symbol:
 * a multi-algorithm coin has a row per algorithm (DigiByte has five, each
 * with its own hashrate and pools), and unrelated coins can share a ticker
 * (MYT). The row with the largest market cap, then the most pools, is kept.
 * Malformed rows are skipped.
 */
export function coinsFromData(rows: unknown[], fileTime?: number | null): FoundLiveCoin[] {
  const best = new Map<string, FoundLiveCoin>();
  for (const raw of rows) {
    const row = CoinRowSchema.safeParse(raw);
    const coin = row.success ? toLiveCoin(row.data, fileTime) : undefined;
    if (!coin) continue;
    const held = best.get(coin.symbol);
    if (!held || rank(coin, held) < 0) best.set(coin.symbol, coin);
  }
  return [...best.values()];
}

/** The coins asked for, or the `limit` largest by market cap (the shared rule every whole-table source uses). */
export const selectCoins = (coins: FoundLiveCoin[], req: SnapshotRequest) => pickCoins(coins, req);

async function fetchCoinsData(call: ProviderCall) {
  const home = await call.http.send({ url: HOME }, call.context);
  if (home.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${home.status} (homepage)`, home.status);
  const url = coinsDataUrl(home.text);
  if (!url) throw new ProviderFailure(ErrorCode.UpstreamFailed, "coin table link not found on the homepage", home.status);
  const { response, data } = await call.http.json({ url }, CoinsDataSchema, call.context);
  if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status} (coin table)`, response.status);
  return data;
}

/**
 * MiningPoolStats: live network figures (hashrate, difficulty, pools, block
 * times, issuance) for about 500 proof-of-work coins, with price and market cap.
 */
export function miningPoolStats(options: MiningPoolStatsOptions = {}): CryptoProvider {
  const table = async (call: ProviderCall) => {
    const data = await fetchCoinsData(call);
    return coinsFromData(data.data, data.time);
  };
  return {
    id: ProviderId.MiningPoolStats,
    costPerCall: options.costPerCall ?? 0,
    capabilities: MINING_POOL_STATS_CAPABILITIES,
    table,
    async snapshot(req, call) {
      return { coins: pickCoins(await table(call), req) };
    },
  };
}
