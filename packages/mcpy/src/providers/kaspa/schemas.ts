import { z } from "zod";

/**
 * One sample of /info/hashrate/history/{YYYY-MM | YYYY-MM-DD} (verified live
 * 2026-11-25): about every 15 minutes, newest first. Other fields the API
 * sends (daaScore, date_time, bits) are not read; blueScore locates a block
 * whose coinbase states the subsidy then (subsidy.ts).
 *
 * hashrate_kh is kH/s and is worked out from the difficulty:
 * hashrate_kh × 1000 = difficulty × 2 × blocks a second (ratio 20 on every
 * sample of Oct–Nov 2026, 2 before Crescendo; /info/hashrate's TH/s figure
 * agreed).
 */
export const SampleSchema = z.object({
  /** Unix milliseconds. */
  timestamp: z.number().finite(),
  difficulty: z.number().finite().positive(),
  hashrate_kh: z.number().finite().positive(),
  blueScore: z.number().int().nonnegative().optional(),
});
export type Sample = z.infer<typeof SampleSchema>;

/** Samples are validated one by one: a bad sample is skipped, not the period. */
export const HistoryResponseSchema = z.array(z.unknown());
