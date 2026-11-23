import type { QuotaAlertSink } from "mcpy";
import type { Telemetry } from "mcpy/telemetry";
import { Pager, pageSafely } from "./alerts.js";
import type { CapWatch } from "./budget.js";
import type { Env, ServerEnv } from "./env.js";

/** One pager per isolate, so its cooldowns persist across requests. */
const pagers = new WeakMap<object, Pager | null>();

export function pagerFor(env: Env, config: ServerEnv): Pager | undefined {
  let pager = pagers.get(env);
  if (pager === undefined) {
    pager =
      config.PUSHOVER_TOKEN && config.PUSHOVER_USER
        ? new Pager({ keys: { token: config.PUSHOVER_TOKEN, user: config.PUSHOVER_USER }, store: env.CACHE, cooldownSeconds: config.ALERT_COOLDOWN_SECONDS })
        : null;
    pagers.set(env, pager);
  }
  return pager ?? undefined;
}

/** This request's alert hooks: quota alerts for the SDK, cap alerts for the budget. */
export function alertHooks(
  pager: Pager | undefined,
  client: string,
  capUsd: number | undefined,
  warnPercent: number,
  telemetry: Telemetry,
): { onQuota?: QuotaAlertSink; capWatch?: CapWatch } {
  if (!pager) return {};
  const onQuota: QuotaAlertSink = (alert) => pageSafely(() => pager.quota(alert, client), telemetry);
  if (capUsd === undefined) return { onQuota };
  return {
    onQuota,
    // At 100% the warning line is the cap itself, and only the cap alert is sent.
    capWatch: {
      warnAt: warnPercent / 100,
      onCapNear: (spentUsd) => pageSafely(() => pager.capNear(client, capUsd, spentUsd), telemetry),
      onCapReached: (spentUsd) => pageSafely(() => pager.capReached(client, capUsd, spentUsd), telemetry),
    },
  };
}
