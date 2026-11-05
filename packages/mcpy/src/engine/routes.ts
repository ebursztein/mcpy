/**
 * Site routes: which page provider last served a site. Providers are ordered
 * cheapest first (direct fetch, then a browser, then paid unblockers), so a
 * site that blocks the cheap ones would otherwise pay for failed attempts on
 * every call. Once a later provider serves a site, the next call starts with
 * it. The providers it skipped stay at the end of the chain, so coverage
 * never shrinks, and the memory expires so cheaper providers are re-tried.
 */

import { z } from "zod";
import type { Cache } from "./cache.js";

const ROUTE_VERSION = "v1";

const SiteRouteSchema = z.object({ provider: z.string().min(1) });

/** Remembers, per site and format, the provider that last served it. */
export class SiteRoutes {
  constructor(
    private readonly cache: Cache,
    private readonly ttlSeconds: number,
  ) {}

  /** The site's remembered provider, if any. */
  async recall(site: string): Promise<string | undefined> {
    const saved = SiteRouteSchema.safeParse(await this.cache.get(key(site)));
    return saved.success ? saved.data.provider : undefined;
  }

  /** Remember that `provider` served `site`. */
  remember(site: string, provider: string): Promise<void> {
    return this.cache.put(key(site), { provider }, this.ttlSeconds);
  }
}

const key = (site: string) => `route:${ROUTE_VERSION}:${site}`;

/** The site a page request belongs to: its format and lowercase hostname. */
export function siteOf(url: string, format: string): string | undefined {
  try {
    return `${format}:${new URL(url).hostname.toLowerCase()}`;
  } catch {
    return undefined;
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
