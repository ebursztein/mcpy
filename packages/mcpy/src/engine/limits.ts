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
  /** How long a site's page provider is remembered before cheaper ones are tried first again. */
  siteRouteTtlSeconds: z.number().int().min(60).max(30 * 86_400).default(86_400),
  /** Thorough mode: after the first provider answers, how long to wait for the others. */
  thoroughGraceMs: z.number().int().min(0).max(120_000).default(8_000),
});
export type EngineLimits = z.infer<typeof EngineLimitsSchema>;
