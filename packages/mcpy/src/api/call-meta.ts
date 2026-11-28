/** What an operation's result and span say about the call itself: its cost and its target. */
import { roundUsd } from "../engine/meter.js";
import { Attr } from "../telemetry/attributes.js";

/** Every result's meta states what the call cost the caller, failed attempts included. */
export function withCost(result: unknown, usd: number): void {
  const meta = (result as { meta?: Record<string, unknown> } | null)?.meta;
  if (meta && typeof meta === "object") meta["cost_usd"] = roundUsd(usd);
}

/** Host and user-agent profile of a validated input, for spans and metrics. */
export function targetAttributes(input: unknown): Record<string, string> {
  const { url, user_agent } = input as { url?: string; user_agent?: string };
  const out: Record<string, string> = {};
  if (url) {
    try {
      out[Attr.TargetHost] = new URL(url).host;
    } catch {
      // invalid URLs are rejected later with invalid_target
    }
  }
  if (user_agent) out[Attr.UserAgentProfile] = user_agent;
  return out;
}
