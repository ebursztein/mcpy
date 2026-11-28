/**
 * Site routes: which page provider last served a site. Providers are ordered
 * cheapest first (direct fetch, then a browser, then paid unblockers), so a
 * site that blocks the cheap ones would otherwise pay for failed attempts on
 * every call. Once a later provider serves a site, the next call starts with
 * it. The providers it skipped stay at the end of the chain, so coverage
 * never shrinks, and the memory expires so cheaper providers are re-tried.
 */

import type { CacheContext, SharedCache } from "../cache/shared.js";
import { Attr } from "../telemetry/attributes.js";
import { PaidFailureSpace, SiteRouteSpace } from "./spaces.js";

/** Remembers, per site and format, the provider that last served it. */
export class SiteRoutes {
  constructor(
    private readonly cache: SharedCache,
    private readonly ttlSeconds: number,
  ) {}

  /** The site's remembered provider, if any. */
  async recall(site: string, ctx?: CacheContext): Promise<string | undefined> {
    return (await this.cache.read(SiteRouteSpace, site, ctx))?.value;
  }

  /** Remember that `provider` served `site`. */
  remember(site: string, provider: string, ctx?: CacheContext): Promise<void> {
    return this.cache.write(SiteRouteSpace, site, provider, this.ttlSeconds, ctx);
  }
}

/**
 * Sites whose paid sources all just failed. A call that paid for every
 * escalation and still got nothing would pay for the same failures on the
 * next call, and on every call after it (a poll every minute pays all day).
 * For a while after such a failure the site gets its free sources only; when
 * the memory expires, the paid ones get one more chance.
 */
export class PaidFailures {
  constructor(
    private readonly cache: SharedCache,
    private readonly ttlSeconds: number,
  ) {}

  get seconds(): number {
    return this.ttlSeconds;
  }

  /** Whether the site's paid sources all failed within the last `seconds`. */
  async recent(site: string, ctx?: CacheContext): Promise<boolean> {
    return (await this.cache.read(PaidFailureSpace, site, ctx)) !== undefined;
  }

  /** Remember that every paid source just failed for `site`. */
  remember(site: string, ctx?: CacheContext): Promise<void> {
    return this.cache.write(PaidFailureSpace, site, true, this.ttlSeconds, ctx);
  }
}

/** The site a page request belongs to: its format and lowercase hostname. */
export function siteOf(url: string, format: string): string | undefined {
  try {
    return `${format}:${new URL(url).hostname.toLowerCase()}`;
  } catch {
    return undefined;
  }
}

/** The attempt-span attribute naming a page request's host (none for a bad URL). */
export function targetHostAttributes(url: string): Record<string, string> {
  try {
    return { [Attr.TargetHost]: new URL(url).host };
  } catch {
    return {};
  }
}

/**
 * The chain order for a site whose remembered provider is `preferred`: that
 * provider first, then the ones after it, then the ones it was ahead of.
 */
export function routeOrder<P extends { id: string }>(providers: readonly P[], preferred: string | undefined): P[] {
  const index = preferred === undefined ? -1 : providers.findIndex((p) => p.id === preferred);
  if (index <= 0) return [...providers];
  return [...providers.slice(index), ...providers.slice(0, index)];
}
