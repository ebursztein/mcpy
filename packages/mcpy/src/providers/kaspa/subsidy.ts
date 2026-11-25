/**
 * KAS's block subsidy, read off the chain (owner, 2026-11-25: block figures
 * come from data, never from a schedule). Every Kaspa coinbase transaction's
 * payload starts with the block's blue score and its subsidy, both u64
 * little-endian, the subsidy in sompi (1e-8 KAS). Verified live 2026-11-25:
 * 2.06017223 KAS at blue score 581,235,252 (2026-11-03 23:57) and 1.94454365
 * at 582,090,474 (2026-11-04 23:46), the monthly step between them.
 */

import { z } from "zod";
import { ErrorCode } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import type { ProviderCall } from "../types.js";
import { fillSteps } from "../step-fill.js";
import type { Sample } from "./schemas.js";

const API = "https://api.kaspa.org/blocks-from-bluescore";
/** The coinbase transaction's subnetwork; ordinary ones are all zeros. */
const COINBASE_SUBNETWORK = "0100000000000000000000000000000000000000";
const SOMPI_PER_KAS = 1e8;
/**
 * Reads allowed for one window. A read is about 66 KB (two blocks with their
 * transactions); a 40-day window with one monthly step takes about 26.
 */
export const MAX_SUBSIDY_READS = 40;

const BlocksSchema = z.array(
  z.object({
    transactions: z.array(z.object({ subnetworkId: z.string().nullish(), payload: z.string().nullish() }).passthrough()).nullish(),
  }).passthrough(),
);

export const blocksUrl = (blueScore: number) => `${API}?blueScore=${blueScore}&includeTransactions=true`;

/** The subsidy a coinbase payload states, in KAS; undefined for a payload too short or not hex. */
export function subsidyOfPayload(payload: string): number | undefined {
  if (!/^(?:[0-9a-f]{2})+$/i.test(payload) || payload.length < 32) return undefined;
  let sompi = 0n;
  for (let i = 15; i >= 8; i--) sompi = (sompi << 8n) | BigInt(parseInt(payload.slice(i * 2, i * 2 + 2), 16));
  const kas = Number(sompi) / SOMPI_PER_KAS;
  return kas > 0 ? kas : undefined;
}

/** The subsidy of a block at this blue score, from its coinbase; undefined when no block there has one. */
export async function subsidyAt(blueScore: number, call: ProviderCall): Promise<number | undefined> {
  const { response, data } = await call.http.json({ url: blocksUrl(blueScore) }, BlocksSchema, call.context);
  if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status} (blocks)`, response.status);
  for (const block of data) {
    const coinbase = block.transactions?.find((t) => t.subnetworkId === COINBASE_SUBNETWORK && t.payload);
    const subsidy = coinbase?.payload ? subsidyOfPayload(coinbase.payload) : undefined;
    if (subsidy !== undefined) return subsidy;
  }
  return undefined;
}

/**
 * Coins issued each day: its blocks × the mean subsidy over its samples. Samples come every
 * 15 minutes and blocks at a fixed rate, so on a day the subsidy steps down the mean weighs each
 * side by its time, to within one sample. A day missing a reading is left out, never guessed.
 */
export async function issuedByDay(
  samplesByDay: ReadonlyMap<string, Sample[]>,
  blocksOf: (day: string) => number | undefined,
  call: ProviderCall,
): Promise<Map<string, number>> {
  const days = [...samplesByDay.keys()].sort();
  const points = days.flatMap((d) => samplesByDay.get(d)!.filter((s) => s.blueScore !== undefined).map((s) => ({ day: d, blueScore: s.blueScore! })));
  const subsidies = await fillSteps(points, (p) => subsidyAt(p.blueScore, call), { maxReads: MAX_SUBSIDY_READS });
  const issued = new Map<string, number>();
  for (const day of days) {
    const blocks = blocksOf(day);
    const values = points.flatMap((p, i) => (p.day === day ? [subsidies[i]] : []));
    if (!blocks || values.length !== samplesByDay.get(day)!.length || values.some((v) => v === undefined)) continue;
    issued.set(day, (blocks * values.reduce((sum, v) => sum! + v!, 0)!) / values.length);
  }
  return issued;
}
