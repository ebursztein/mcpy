import { z } from "zod";

/**
 * A number as the coin table states it. Most are JSON numbers, but some rows
 * carry numeric strings (seen live 2026-11-25: DOGE's `diff` "44179526.9" and
 * `time` "1795627879"); those are read as numbers. Missing, null or "": undefined;
 * any other string fails the row.
 */
export const looseNumber = z
  .preprocess((v) => (typeof v !== "string" ? v : v.trim() === "" ? undefined : Number(v)), z.number().finite().optional())
  .nullish();
const text = z.string().nullish();

/**
 * One row of coins_data.js (verified live 2026-11-25, 494 rows). Every field
 * but the symbol may be missing or null on some row: 180 rows have no price,
 * 234 no market cap.
 *
 * hashrate, ph: network and known pools' hashrate, in `unit`.
 * pr, mc, v24: USD price, market cap, 24h volume. c7d: 7-day price change, %.
 * e24: coins issued in the last 24 h (-1: unknown). bt, target: actual and
 * target block time, s. typ: ASIC, GPU, CPU, HDD or "". time: Unix seconds of
 * the reading. m: true on each algorithm's row of a multi-algorithm coin.
 * p7d: 7-day price series (USD x 1e7, about every 4 h), not read; diff7: the
 * last 7 daily difficulties, oldest first. Neither is a hashrate series.
 */
export const CoinRowSchema = z.object({
  symbol: z.string().trim().min(1),
  name: text,
  algo: text,
  unit: text,
  typ: text,
  height: looseNumber,
  hashrate: looseNumber,
  ph: looseNumber,
  diff: looseNumber,
  pools: looseNumber,
  target: looseNumber,
  bt: looseNumber,
  e24: looseNumber,
  pr: looseNumber,
  mc: looseNumber,
  v24: looseNumber,
  c7d: looseNumber,
  time: looseNumber,
  m: z.boolean().nullish(),
  /** Checked value by value when mapped: one bad entry drops it, never the row. */
  diff7: z.array(z.unknown()).nullish(),
});
export type CoinRow = z.infer<typeof CoinRowSchema>;

/** The whole file: rows are validated one by one, so one bad row is skipped, not the file. */
export const CoinsDataSchema = z.object({
  data: z.array(z.unknown()),
  time: looseNumber,
});
