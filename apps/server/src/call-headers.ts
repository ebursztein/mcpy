/**
 * Response headers on every REST operation, so a caller can pace itself
 * without parsing the body or calling /v1/usage:
 *
 *   X-Mcpy-Cache                 hit | miss | bypass (answered from the cache or fetched)
 *   X-Mcpy-Cost-Usd              what this call counted against the daily cap
 *   X-Mcpy-Budget-Used-Usd       today's spend, this call included
 *   X-Mcpy-Budget-Limit-Usd      the client's daily cap
 *   X-Mcpy-Budget-Remaining-Usd  what is left of it today
 *   X-Mcpy-Budget-Reset          seconds until the cap resets (00:00 UTC)
 *   RateLimit-Policy, X-RateLimit-Limit   the per-key request limit
 *
 * Cache and cost come from the result's meta, so only answered calls carry
 * them. The budget headers need a cap; today's spend is read while the call
 * runs, so calls running at the same time may not see each other's cost.
 * The rate limit's own count is not reported: Cloudflare's binding only
 * answers whether a request may run.
 */

import { secondsUntilReset } from "./budget.js";
import { CLIENT_RATE_LIMIT } from "./rate-limit.js";

export const CallHeader = {
  Cache: "X-Mcpy-Cache",
  CostUsd: "X-Mcpy-Cost-Usd",
  BudgetUsedUsd: "X-Mcpy-Budget-Used-Usd",
  BudgetLimitUsd: "X-Mcpy-Budget-Limit-Usd",
  BudgetRemainingUsd: "X-Mcpy-Budget-Remaining-Usd",
  BudgetReset: "X-Mcpy-Budget-Reset",
} as const;

/** One client's cap and a way to read what it spent today. */
export interface CallBudget {
  capUsd: number;
  spentToday: () => Promise<number>;
}

/** The per-key request limit, on every authenticated response. */
export function rateLimitPolicyHeaders(): Record<string, string> {
  const { requests, periodSeconds } = CLIENT_RATE_LIMIT;
  return { "RateLimit-Policy": `${requests};w=${periodSeconds}`, "X-RateLimit-Limit": String(requests) };
}

/** Cache status and cost of an answered call, from its result's meta. */
export function resultHeaders(result: unknown): { headers: Record<string, string>; costUsd: number } {
  const meta = (result as { meta?: { cache?: unknown; cost_usd?: unknown } } | null)?.meta;
  const headers: Record<string, string> = {};
  if (typeof meta?.cache === "string") headers[CallHeader.Cache] = meta.cache;
  const costUsd = typeof meta?.cost_usd === "number" ? meta.cost_usd : 0;
  if (typeof meta?.cost_usd === "number") headers[CallHeader.CostUsd] = usd(costUsd);
  return { headers, costUsd };
}

/** Today's spend against the cap, `costUsd` (this call) included. */
export function budgetHeaders(capUsd: number, spentBeforeUsd: number, costUsd: number, now = new Date()): Record<string, string> {
  const used = spentBeforeUsd + costUsd;
  return {
    [CallHeader.BudgetUsedUsd]: usd(used),
    [CallHeader.BudgetLimitUsd]: usd(capUsd),
    [CallHeader.BudgetRemainingUsd]: usd(Math.max(0, capUsd - used)),
    [CallHeader.BudgetReset]: String(secondsUntilReset(now)),
  };
}

/** Micro-dollars, like result meta, without float noise or exponents. */
const usd = (value: number): string => String(Math.round(value * 1e6) / 1e6);
