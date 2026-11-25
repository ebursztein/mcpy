import { z } from "zod";

/** A number as Insight states it: JSON numbers, or decimal strings for coin values ("0.41097067"). */
const decimal = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().finite());

/**
 * GET /insight-api/blocks?blockDate=YYYY-MM-DD&limit=n (verified live
 * 2026-11-25): the day's blocks, newest first, e.g. height 2,577,886 at
 * 23:59:30 first for 2026-11-24.
 */
export const DayBlocksSchema = z.object({
  blocks: z.array(z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/i), height: z.number().int().nonnegative(), time: z.number() }).passthrough()),
});

/**
 * GET /insight-api/txs?block={hash}: the block's transactions, the coinbase
 * first (isCoinBase). An ordinary coinbase has three outputs: the miner, a
 * masternode and Platform's credit pool, in no fixed order. A superblock's
 * adds the treasury's payees.
 */
export const BlockTxsSchema = z.object({
  txs: z.array(
    z.object({
      isCoinBase: z.boolean().nullish(),
      valueOut: decimal,
      vout: z.array(z.object({ value: decimal }).passthrough()),
    }).passthrough(),
  ),
});
