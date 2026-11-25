import { z } from "zod";

/** An optional figure: anything but a finite number (a string, NaN) reads as absent, so one bad field never sinks its row. */
const num = z.number().finite().nullish().catch(undefined);
const text = z.string().nullish().catch(undefined);

/**
 * One /coins/markets row, the fields mcpy reads (verified live 2026-11-25
 * with price_change_percentage=24h,7d). Parsed row by row: only a row
 * without an id, a symbol or a valid last_updated is skipped.
 */
export const MarketRowSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: text,
  current_price: num,
  market_cap: num,
  market_cap_rank: z.number().int().positive().nullish().catch(undefined),
  fully_diluted_valuation: num,
  total_volume: num,
  high_24h: num,
  low_24h: num,
  price_change_percentage_24h: num,
  price_change_percentage_24h_in_currency: num,
  price_change_percentage_7d_in_currency: num,
  circulating_supply: num,
  total_supply: num,
  max_supply: num,
  ath: num,
  ath_date: z.iso.datetime({ offset: true }).nullish().catch(undefined),
  last_updated: z.iso.datetime({ offset: true }),
});
export type MarketRow = z.infer<typeof MarketRowSchema>;

export const MarketsResponseSchema = z.array(z.unknown());

/** /global: whole-market totals keyed by currency; `updated_at` is Unix seconds. */
export const GlobalResponseSchema = z.object({
  data: z.object({
    total_market_cap: z.record(z.string(), z.number()),
    total_volume: z.record(z.string(), z.number()).nullish().catch(undefined),
    market_cap_percentage: z.record(z.string(), z.number()).nullish().catch(undefined),
    market_cap_change_percentage_24h_usd: num,
    active_cryptocurrencies: z.number().int().positive().nullish().catch(undefined),
    markets: z.number().int().positive().nullish().catch(undefined),
    updated_at: z.number().int().positive(),
  }),
});
export type GlobalResponse = z.infer<typeof GlobalResponseSchema>;

/** [Unix ms, value]; a value may be null for a coin with no figure that day. */
const series = z.array(z.tuple([z.number().int(), z.number().finite().nullable()])).default([]);

/** /coins/{id}/market_chart with interval=daily. */
export const ChartResponseSchema = z.object({
  prices: series,
  market_caps: series,
  total_volumes: series,
});
export type ChartResponse = z.infer<typeof ChartResponseSchema>;

/**
 * Error bodies seen live: 429 `{status: {error_code, error_message}}`, 400
 * `{error: "..."}`, 401 (history past 365 days) `{error: {status: {...}}}`.
 */
const status = z.object({ error_message: z.string().nullish() }).partial();
export const ErrorBodySchema = z
  .object({
    status: status.nullish(),
    error: z.union([z.string(), z.object({ status: status.nullish() }).partial()]).nullish(),
  })
  .partial();
