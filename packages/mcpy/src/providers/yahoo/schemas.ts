/** Yahoo's chart answer, as seen live 2026-11-28 (AAPL, ^GSPC, BRK-B). Only what mcpy reads; the rest passes. */

import { z } from "zod";

const num = z.number().nullable().optional();
const series = z.array(z.number().nullable()).optional();

const MetaSchema = z.looseObject({
  currency: z.string().nullable().optional(),
  symbol: z.string().optional(),
  exchangeName: z.string().nullable().optional(),
  fullExchangeName: z.string().nullable().optional(),
  instrumentType: z.string().nullable().optional(),
  /** Unix seconds of the latest regular-session price. */
  regularMarketTime: z.number().optional(),
  /** Seconds the exchange's zone is from UTC (-18000 for New York in winter). */
  gmtoffset: z.number().optional(),
  regularMarketPrice: num,
  regularMarketDayHigh: num,
  regularMarketDayLow: num,
  regularMarketVolume: num,
  fiftyTwoWeekHigh: num,
  fiftyTwoWeekLow: num,
  longName: z.string().nullable().optional(),
  shortName: z.string().nullable().optional(),
});

const DividendSchema = z.looseObject({ amount: z.number(), date: z.number() });
const SplitSchema = z.looseObject({ date: z.number(), numerator: z.number(), denominator: z.number() });

const ResultSchema = z.looseObject({
  meta: MetaSchema,
  /** Unix seconds of each bar's session open. */
  timestamp: z.array(z.number()).optional(),
  events: z
    .looseObject({
      dividends: z.record(z.string(), DividendSchema).optional(),
      splits: z.record(z.string(), SplitSchema).optional(),
    })
    .optional(),
  indicators: z
    .looseObject({
      quote: z.array(z.looseObject({ open: series, high: series, low: series, close: series, volume: series })).optional(),
      adjclose: z.array(z.looseObject({ adjclose: series })).optional(),
    })
    .optional(),
});

export const ChartResponseSchema = z.looseObject({
  chart: z.looseObject({
    result: z.array(ResultSchema).nullable().optional(),
    error: z.unknown().optional(),
  }),
});

export type ChartResult = z.infer<typeof ResultSchema>;
