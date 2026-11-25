import { z } from "zod";

/**
 * One retarget of /api/v1/mining/difficulty-adjustments/{period} (mempool.space for BTC,
 * litecoinspace.org for LTC, the same software; verified live 2026-11-25), newest first:
 * [block time (Unix seconds), block height, the new difficulty, its ratio to the previous one].
 */
export const AdjustmentSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().finite().positive(), z.number().finite()]);
export type Adjustment = z.infer<typeof AdjustmentSchema>;

export const AdjustmentsResponseSchema = z.array(AdjustmentSchema);
