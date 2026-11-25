/**
 * DRAFT, not wired to any tool yet: public contract for crypto.market and crypto.coin.
 * No provider appears anywhere. Every measured field is optional (no source has them all);
 * new fields may be added later, but none is renamed, removed or retyped.
 * Numbers are the source's own values, never figures read back from a page's rounded display.
 */

import { z } from "zod";
import { enumOf } from "./enums.js";
import { ResultMetaSchema } from "./schemas.js";

/** Most coins one crypto.coin call may ask for. */
export const MAX_COINS = 50;
/** Most coins one crypto.market call lists: a row with every figure and fact at full precision is about 1,060 characters, so 40 stay under the 50,000-character ceiling. */
export const MAX_MARKET_COINS = 40;
export const DEFAULT_MARKET_COINS = 40;
/** Most day rows one crypto.coin call returns (coins × days): a complete day with every figure at full precision is about 1,100 characters, so 40 stay under the 50,000-character ceiling. A longer history takes several calls with from/to. */
export const MAX_COIN_ROWS = 40;
/** Default max_age, in seconds. */
export const DEFAULT_CRYPTO_MAX_AGE_SECONDS = { market: 900, coin: 900 } as const;
/**
 * Every crypto answer is reused for at least this long, whatever max_age asks: the
 * market data key is shared and rate-limited (owner, 2026-11-25: "cache for 5 min every time").
 */
export const MIN_CRYPTO_MAX_AGE_SECONDS = 300;

const cryptoMaxAge = (defaultSeconds: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(30 * 86_400)
    .default(defaultSeconds)
    .describe(`Oldest cached answer to accept, in seconds (default ${defaultSeconds}); anything under ${MIN_CRYPTO_MAX_AGE_SECONDS} counts as ${MIN_CRYPTO_MAX_AGE_SECONDS}`);

/** Whether a day is over (its figures are final) or is today, read live. */
const coinDayStatus = enumOf({ Complete: "complete", Live: "live" } as const);
export const CoinDayStatus = coinDayStatus.values;
export const CoinDayStatusSchema = coinDayStatus.schema;
export type CoinDayStatus = z.infer<typeof CoinDayStatusSchema>;

/** What network_hashrate_hs counts: hashes, or solutions for Equihash coins (ZEC). Hashprice is per the same unit. */
const hashrateUnit = enumOf({ HS: "H/s", SolS: "Sol/s" } as const);
export const HashrateUnit = hashrateUnit.values;
export const HashrateUnitSchema = hashrateUnit.schema;
export type HashrateUnit = z.infer<typeof HashrateUnitSchema>;

/** The hardware a proof-of-work coin is mined with. */
const miningHardware = enumOf({ Asic: "asic", Gpu: "gpu", Cpu: "cpu" } as const);
export const MiningHardware = miningHardware.values;
export const MiningHardwareSchema = miningHardware.schema;
export type MiningHardware = z.infer<typeof MiningHardwareSchema>;

const usd = z.number().finite().nonnegative();
const amount = z.number().finite().nonnegative();
const symbol = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{1,15}$/, "a ticker like BTC");
/** Tickers compare upper-case. */
export const upperSymbols = (symbols: string[]) => symbols.map((s) => s.trim().toUpperCase());
const eachOnce = (s: string[]) => new Set(upperSymbols(s)).size === s.length;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a UTC day, YYYY-MM-DD");
const isoTime = z.iso.datetime({ offset: true });
const pct = z.number().finite();
/** USD a day per H/s: tiny numbers (BTC about 5e-17, RVN about 2e-9), so callers scale to their unit. */
const hashprice = z.number().finite().nonnegative();
const HASHPRICE =
  "Hashprice: USD a day that 1 H/s (1 Sol/s for Equihash) earns, before pool fee and power; a merge-mined " +
  "coin's is its own, not added to its parent's. Only for coins whose miners' share is known.";

// ---- crypto.market ----

export const CryptoMarketInputSchema = z.object({
  symbols: z
    .array(symbol)
    .min(1)
    .max(MAX_MARKET_COINS)
    .refine(eachOnce, "each symbol once")
    .optional()
    .describe("Only these tickers; default: the largest coins by market cap"),
  limit: z.number().int().min(1).max(MAX_MARKET_COINS).default(DEFAULT_MARKET_COINS).describe("Most coins listed when symbols is not set"),
  max_age: cryptoMaxAge(DEFAULT_CRYPTO_MAX_AGE_SECONDS.market),
});

/** What a coin is: the same fields on a market row and on a crypto.coin coin. */
const COIN_FACTS = {
  symbol: z.string(),
  name: z.string(),
  algorithm: z.string().optional().describe("Proof-of-work algorithm, e.g. SHA-256, KawPow"),
  mined_with: MiningHardwareSchema.optional(),
  block_time_target_s: amount.optional().describe("The protocol's target seconds between blocks; absent unless the measured block time is within 2x of it (a stale target is left out)"),
  block_height: z.number().int().nonnegative().optional().describe("Latest block height"),
  hashrate_unit: HashrateUnitSchema.optional().describe("The unit of every *_hashrate_hs figure and of hashprice: H/s, or Sol/s for Equihash coins"),
  quoted_hashrate_unit: z.string().optional().describe("The unit miners usually quote this coin's hashrate in, e.g. TH/s for BTC, GSol/s for ZEC"),
  quoted_hashrate_unit_hs: amount.optional().describe("Size of quoted_hashrate_unit in hashrate_unit: divide a hashrate by it, multiply a hashprice by it (BTC: 1e12)"),
  miner_share_pct: pct.optional().describe("Share of each block's new coins its miner receives (ZEC 80, DASH 20); absent where not known"),
  miner_fee_share_pct: pct.optional().describe("Share of a block's fees its miner keeps, today (ZEC 40 since NU7); absent where not known"),
  merge_mined_with: z.string().optional().describe("The coin whose work also mines this one (DOGE: LTC): a machine earns both"),
};

/**
 * A coin's figures, under one name wherever the measure is the same: a market row and a live
 * day carry these exactly; a complete day carries those its sources have for that day.
 * "Now" means a market row or a live day; "a complete day" means that UTC day.
 */
const FIGURES = {
  price_usd: usd.positive().optional().describe("Now: the latest price; a complete day: its closing price"),
  price_change_24h_pct: pct.optional(),
  price_change_7d_pct: pct.optional().describe("Percent change from 7 days ago, e.g. -26.01"),
  high_24h_usd: usd.optional(),
  low_24h_usd: usd.optional(),
  all_time_high_usd: usd.optional(),
  all_time_high_date: isoDay.optional(),
  market_cap_usd: usd.optional(),
  market_cap_rank: z.number().int().positive().optional(),
  fully_diluted_value_usd: usd.optional(),
  volume_24h_usd: usd
    .optional()
    .describe("Trading volume across all tracked markets over 24 hours (a complete day: that day). The same measure everywhere, unlike reported_spot_volume_usd"),
  supply: amount.optional().describe("Circulating supply, in coins"),
  total_supply: amount.optional(),
  max_supply: amount.optional(),
  network_hashrate_hs: amount
    .optional()
    .describe(
      "H/s (Sol/s for Equihash); absent for coins that are not mined. Now: the network's current estimate; a complete day: " +
        "the work of its own blocks (each block's difficulty × its algorithm's hashes per unit of difficulty) ÷ 86,400 s, so block luck cancels out",
    ),
  difficulty: amount.optional().describe("Now: the current one; a complete day: at its last block"),
  difficulty_change_7d_pct: pct.optional().describe("From the oldest of the last 7 daily difficulties to the newest (6 days apart)"),
  block_time_s: amount.optional().describe("Average seconds between blocks, lately"),
  pools: z.number().int().positive().optional().describe("Known mining pools"),
  pool_hashrate_hs: amount.optional().describe("Combined hashrate of the known pools"),
  pool_share_pct: pct.optional().describe("pool_hashrate_hs as a share of network_hashrate_hs. Both are estimates, so it can pass 100 (BTC, 2026-11-25: 105)"),
  issued_24h_coins: amount.optional().describe("Coins issued over 24 hours (a complete day: that day), miners' or not"),
  hashprice_usd_per_hs_day: hashprice
    .optional()
    .describe(
      `${HASHPRICE} Now: the latest price × the miners' share of the last 24 hours' new coins ÷ the current hashrate (fees not counted); ` +
        "where no source states those coins (ZEC, DASH), they are what miners received per block on the latest complete day × 86,400 ÷ block_time_s; " +
        "a complete day: price_usd × (miner_subsidy_coins + miner_fees_coins) ÷ network_hashrate_hs, fees left out only for coins no source states them for (KAS, DASH). " +
        "Per hashrate_unit: multiply by quoted_hashrate_unit_hs for the quoted unit (BTC: USD per TH/s a day).",
    ),
};

/** One coin as it stands now. History is crypto.coin's. */
export const MarketCoinSchema = z.object({
  ...COIN_FACTS,
  ...FIGURES,
  as_of: isoTime.describe("When this coin's figures were read"),
});

export const CryptoMarketResultSchema = z.object({
  as_of: isoTime.describe("When this answer was put together"),
  total_market_cap_usd: usd.positive().optional().describe("Absent only when no source had the totals"),
  total_volume_24h_usd: usd.optional(),
  btc_dominance_pct: z.number().min(0).max(100).optional().describe("Bitcoin's share of the total market cap"),
  total_market_cap_change_24h_pct: pct.optional(),
  active_coins: z.number().int().nonnegative().optional().describe("Coins tracked by the market data"),
  markets: z.number().int().nonnegative().optional().describe("Exchange markets tracked"),
  coins: z.array(MarketCoinSchema).describe("In the order asked, else largest market cap first"),
  missing: z.array(z.string()).describe("Asked-for symbols no source knows"),
  meta: ResultMetaSchema,
});

// ---- crypto.coin ----

const DAY_MS = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
/** UTC days from `from` to `to`, both included. */
const daySpan = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
const daysBefore = (day: string, n: number) => new Date(Date.parse(day) - n * DAY_MS).toISOString().slice(0, 10);

export const CryptoCoinInputSchema = z
  .object({
    symbols: z
      .array(symbol)
      .min(1)
      .max(MAX_COINS)
      .refine(eachOnce, "each symbol once")
      .describe("Tickers, e.g. [\"BTC\", \"RVN\"]"),
    days: z
      .number()
      .int()
      .min(1)
      .max(MAX_COIN_ROWS)
      .optional()
      .describe("Today and the days before it (UTC); default 1, today only. Or give from/to instead"),
    from: isoDay.optional().describe("First UTC day, YYYY-MM-DD, for history further back"),
    to: isoDay.optional().describe("Last UTC day, YYYY-MM-DD (with from; default today)"),
    max_age: cryptoMaxAge(DEFAULT_CRYPTO_MAX_AGE_SECONDS.coin),
  })
  .superRefine((q, ctx) => {
    if (q.days !== undefined && (q.from !== undefined || q.to !== undefined))
      return void ctx.addIssue({ code: "custom", message: "use either days or from/to, not both", path: ["days"] });
    if (q.to !== undefined && q.from === undefined)
      return void ctx.addIssue({ code: "custom", message: "to needs from", path: ["from"] });
    const to = q.to ?? today();
    if (to > today()) return void ctx.addIssue({ code: "custom", message: "to must not be after today (UTC)", path: ["to"] });
    const span = q.from !== undefined ? daySpan(q.from, to) : (q.days ?? 1);
    if (span < 1) return void ctx.addIssue({ code: "custom", message: "from must not be after to", path: ["from"] });
    if (span * q.symbols.length > MAX_COIN_ROWS)
      ctx.addIssue({
        code: "custom",
        message: `at most ${MAX_COIN_ROWS} day rows a call (symbols × days): split the coins or the dates`,
        path: [q.from !== undefined ? "from" : "days"],
      });
  });

/** The query's UTC window: days counts back from today; from/to are taken as given (to defaults to today). */
export function coinWindow(q: CryptoCoinQuery, now = Date.now()): { from: string; to: string } {
  const last = q.to ?? new Date(now).toISOString().slice(0, 10);
  return { from: q.from ?? daysBefore(last, (q.days ?? 1) - 1), to: last };
}

/** The max_age a crypto call really uses: never under the floor. */
export const cryptoMaxAgeOf = (seconds: number) => Math.max(seconds, MIN_CRYPTO_MAX_AGE_SECONDS);

export const CoinDaySchema = z.object({
  date: isoDay,
  status: CoinDayStatusSchema.describe(
    "complete: the UTC day is over and its figures are final; live: today, read at as_of, with exactly a market row's figures. " +
      "Use complete days for anything summed per day (hashprice, issuance).",
  ),
  as_of: isoTime.optional().describe("When a live day was read; absent on complete days"),
  ...FIGURES,
  // Complete days only, where the sources cover the coin.
  reported_spot_volume_usd: usd
    .optional()
    .describe("Spot volume as exchanges report it: counted differently and much lower than volume_24h_usd (BTC, 2026-11-24: $10.2B vs $30.0B); compare it only with itself"),
  blocks: z.number().int().nonnegative().optional().describe("Blocks found in the day"),
  fees_coins: amount.optional().describe("Transaction fees paid in the day, in coins"),
  tx_count: z.number().int().nonnegative().optional().describe("Transactions in the day"),
  miner_subsidy_coins: amount.optional().describe("The part of issued_24h_coins the day's miners received, less what the protocol pays others"),
  miner_fees_coins: amount.optional().describe("The part of fees_coins the day's miners kept, e.g. 40% for ZEC since NU7"),
  issued_24h_usd: usd.optional().describe("USD value of issued_24h_coins"),
  price_btc: amount.optional(),
  market_cap_estimated_usd: usd.optional().describe("Market cap by the source's own free-float estimate"),
  mvrv: amount.optional().describe("Market value over realized value"),
  active_addresses: z.number().int().nonnegative().optional(),
  addresses_with_balance: z.number().int().nonnegative().optional(),
  transfers: z.number().int().nonnegative().optional().describe("Transfers of value (one transaction can make several)"),
  // Exchange figures (BTC, ETH) are the source's preliminary estimates and may be revised later, unlike the rest of a complete day.
  exchange_inflow_coins: amount.optional().describe("Preliminary: may be revised after the day"),
  exchange_inflow_usd: usd.optional(),
  exchange_outflow_coins: amount.optional(),
  exchange_outflow_usd: usd.optional(),
  supply_on_exchanges_coins: amount.optional().describe("Coins held on exchanges at the day's end (preliminary)"),
  supply_on_exchanges_usd: usd.optional(),
  supply_expected_10y_coins: amount.optional().describe("Supply expected 10 years on, by the emission schedule"),
  roi_30d_pct: pct.optional(),
  roi_1y_pct: pct.optional(),
});

export const CoinSchema = z.object({
  ...COIN_FACTS,
  days: z.array(CoinDaySchema).describe("Oldest first; a day no source has is left out, never zero-filled"),
});

export const CryptoCoinResultSchema = z.object({
  coins: z.array(CoinSchema).describe("In the order asked"),
  missing: z.array(z.string()).describe("Symbols no source knows"),
  meta: ResultMetaSchema,
});

export type CryptoMarketInput = z.input<typeof CryptoMarketInputSchema>;
export type CryptoMarketQuery = z.infer<typeof CryptoMarketInputSchema>;
export type MarketCoin = z.infer<typeof MarketCoinSchema>;
export type CryptoMarketResult = z.infer<typeof CryptoMarketResultSchema>;
export type CryptoCoinInput = z.input<typeof CryptoCoinInputSchema>;
export type CryptoCoinQuery = z.infer<typeof CryptoCoinInputSchema>;
export type CoinDay = z.infer<typeof CoinDaySchema>;
export type Coin = z.infer<typeof CoinSchema>;
export type CryptoCoinResult = z.infer<typeof CryptoCoinResultSchema>;
