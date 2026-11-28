/** Alpha Vantage answers, as seen live 2026-11-27. Every figure is a string; an unknown symbol gives an empty "Global Quote". */

import { z } from "zod";

/** Sent in place of data when the key's limit is reached or the request is premium-only. */
const NOTICE = { Information: z.string().optional(), Note: z.string().optional() };

export const QuoteResponseSchema = z.looseObject({
  ...NOTICE,
  "Global Quote": z.record(z.string(), z.string()).optional(),
});

export const DailyResponseSchema = z.looseObject({
  ...NOTICE,
  "Time Series (Daily)": z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

export type Notice = { Information?: string; Note?: string };
