/** Engine time, size and cache limits, with their defaults. */

import { z } from "zod";

export const EngineLimitsSchema = z.object({
  /** Upper bound for a single provider attempt. */
  attemptTimeoutMs: z.number().int().min(1_000).max(300_000).default(20_000),
  /** Upper bound for a whole operation, fallbacks and retries included. */
  deadlineMs: z.number().int().min(1_000).max(600_000).default(60_000),
  /** Largest upstream body read. */
  maxResponseBytes: z.number().int().min(10_000).max(50_000_000).default(5_000_000),
  /** How long pages are kept. */
  pageTtlSeconds: z.number().int().min(60).max(30 * 86_400).default(3_600),
  searchTtlSeconds: z.number().int().min(60).max(30 * 86_400).default(900),
  paperTtlSeconds: z.number().int().min(60).max(30 * 86_400).default(86_400),
  /**
   * How long a site's page provider is remembered before cheaper ones are tried first again.
   * Short on purpose: while a later provider keeps serving, the cheaper ones are never tried,
   * so one passing failure (a rate limit, a timeout) would otherwise pay for a whole day.
   * Re-checking costs at most one failed attempt on each cheaper source, per site per period.
   */
  siteRouteTtlSeconds: z.number().int().min(60).max(30 * 86_400).default(900),
  /**
   * How long a site whose paid page sources all failed gets its free sources only, so a
   * failed escalation is not paid for again on every call. Then the paid ones get another try.
   */
  paidFailureTtlSeconds: z.number().int().min(60).max(86_400).default(900),
  /** Thorough mode: after the first provider answers, how long to wait for the others. */
  thoroughGraceMs: z.number().int().min(0).max(120_000).default(8_000),
});
export type EngineLimits = z.infer<typeof EngineLimitsSchema>;
