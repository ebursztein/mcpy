/**
 * Owner alerts by Pushover (api.pushover.net): a paid source out of credits
 * or quota, and a client crossing its daily cap. Enabled only when
 * PUSHOVER_TOKEN and PUSHOVER_USER are set.
 *
 * - A quota alert pages once per provider and kind per cooldown window. The
 *   window is held in this isolate and in KV, so most isolates stay quiet;
 *   KV is eventually consistent, so two isolates may both page within its
 *   first minute. That is accepted: a duplicate beats a missed page.
 * - Cap alerts need no window: the budget object adds spend one call at a
 *   time, so exactly one add crosses the warning line, and one the cap, each
 *   day (see budget.ts).
 * - The pager failing is logged, never paged through itself.
 */

import { LogLevel, QuotaAlertKind, type KvLike, type QuotaAlert } from "mcpy";
import { Attr, type Telemetry } from "mcpy/telemetry";
import { z } from "zod";

export const PUSHOVER_MESSAGES_URL = "https://api.pushover.net/1/messages.json";

/** Pushover priorities used here: normal, and high (sounds through quiet hours). */
export const PushPriority = { Normal: 0, High: 1 } as const;
export type PushPriority = (typeof PushPriority)[keyof typeof PushPriority];

/** Pushover's own limits. */
const MAX_TITLE = 250;
const MAX_MESSAGE = 1024;
const SEND_TIMEOUT_MS = 10_000;
const ALERT_KEY_VERSION = "v1";

export interface PushoverKeys {
  token: string;
  user: string;
}

export interface Push {
  title: string;
  message: string;
  priority: PushPriority;
}

const SentSchema = z.object({ status: z.literal(1) }).passthrough();

const QUOTA_TEXT: Record<QuotaAlertKind, { what: string; priority: PushPriority }> = {
  [QuotaAlertKind.OutOfCredits]: { what: "is out of credits", priority: PushPriority.High },
  [QuotaAlertKind.RateLimited]: { what: "hit its rate limit or quota", priority: PushPriority.Normal },
};

export function quotaPush(alert: QuotaAlert, client: string, cooldownSeconds: number): Push {
  const { what, priority } = QUOTA_TEXT[alert.kind];
  return {
    title: `mcpy: ${alert.provider} ${what}`,
    message:
      `${alert.provider} answered HTTP ${alert.status} on a call for ${client}. ` +
      `Calls fall back to the next source meanwhile. Next alert for this in ${formatDuration(cooldownSeconds)} at the earliest.`,
    priority,
  };
}

export function capPush(client: string, capUsd: number, spentUsd: number): Push {
  return {
    title: `mcpy: ${client} reached its daily cap`,
    message: `${client} has spent ~$${spentUsd.toFixed(2)} of its $${capUsd.toFixed(2)} cap today. Paid sources are paused for it until 00:00 UTC; the cache and free sources still answer.`,
    priority: PushPriority.Normal,
  };
}

export function capNearPush(client: string, capUsd: number, spentUsd: number): Push {
  return {
    title: `mcpy: ${client} is running low on its daily cap`,
    message: `${client} has spent ~$${spentUsd.toFixed(2)} of its $${capUsd.toFixed(2)} cap today (${Math.round((spentUsd / capUsd) * 100)}%). Paid sources pause for it at the cap, until 00:00 UTC.`,
    priority: PushPriority.Normal,
  };
}

export interface PagerOptions {
  keys: PushoverKeys;
  /** Holds the quota cooldown across isolates; without it, only this isolate remembers. */
  store?: KvLike;
  cooldownSeconds: number;
  fetch?: typeof fetch;
  now?: () => number;
}

export class Pager {
  /** Cooldown ends (epoch ms) this isolate already knows about, by alert key. */
  private readonly quiet = new Map<string, number>();

  constructor(private readonly o: PagerOptions) {}

  /** Page about a paid source's quota, unless the same alert paged within the cooldown. */
  async quota(alert: QuotaAlert, client: string): Promise<void> {
    const key = `alert:${ALERT_KEY_VERSION}:quota:${alert.provider}:${alert.kind}`;
    const now = this.now();
    if ((this.quiet.get(key) ?? 0) > now) return;
    const until = now + this.o.cooldownSeconds * 1_000;
    this.quiet.set(key, until);
    if (this.o.store) {
      const held = z.object({ until: z.number() }).safeParse(await this.o.store.get(key, "json"));
      if (held.success && held.data.until > now) {
        this.quiet.set(key, held.data.until);
        return;
      }
      await this.o.store.put(key, JSON.stringify({ until }), { expirationTtl: Math.max(60, this.o.cooldownSeconds) });
    }
    await this.send(quotaPush(alert, client, this.o.cooldownSeconds));
  }

  capReached(client: string, capUsd: number, spentUsd: number): Promise<void> {
    return this.send(capPush(client, capUsd, spentUsd));
  }

  capNear(client: string, capUsd: number, spentUsd: number): Promise<void> {
    return this.send(capNearPush(client, capUsd, spentUsd));
  }

  async send(push: Push): Promise<void> {
    const doFetch = this.o.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await doFetch(PUSHOVER_MESSAGES_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: this.o.keys.token,
        user: this.o.keys.user,
        title: push.title.slice(0, MAX_TITLE),
        message: push.message.slice(0, MAX_MESSAGE),
        priority: push.priority,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    if (!SentSchema.safeParse(body).success) throw new Error(`pushover refused the push (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }
}

/** Run a page off the request path; its failure goes to the logs only. */
export function pageSafely(work: () => Promise<void>, telemetry: Telemetry): Promise<void> {
  return work().catch((err: unknown) => {
    telemetry.log(LogLevel.Error, "pushover alert failed", { [Attr.Reason]: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
  });
}

function formatDuration(seconds: number): string {
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
