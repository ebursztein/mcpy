/** Nasdaq's quote API answers, as seen live 2026-11-28 (AAPL, SPY, BRK.B, an unknown symbol). Figures are display text. */

import { z } from "zod";

const text = z.string().nullable().optional();
const labelled = z.looseObject({ value: text }).nullable().optional();

const InfoDataSchema = z.looseObject({
  symbol: z.string().optional(),
  companyName: text,
  exchange: text,
  primaryData: z
    .looseObject({
      lastSalePrice: text,
      netChange: text,
      percentageChange: text,
      /** "Nov 27, 2026" */
      lastTradeTimestamp: text,
      volume: text,
    })
    .nullable()
    .optional(),
  keyStats: z.looseObject({ fiftyTwoWeekHighLow: labelled, dayrange: labelled }).nullable().optional(),
});

/** An unknown symbol answers 200 with data null and status.rCode 400. */
export const InfoResponseSchema = z.looseObject({ data: InfoDataSchema.nullable() });

const RowSchema = z.looseObject({ date: z.string(), close: text, volume: text, open: text, high: text, low: text });

export const HistoryResponseSchema = z.looseObject({
  data: z.looseObject({ tradesTable: z.looseObject({ rows: z.array(RowSchema).nullable().optional() }).nullable().optional() }).nullable(),
});

export type InfoData = z.infer<typeof InfoDataSchema>;
