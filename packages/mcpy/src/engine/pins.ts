/**
 * Page pins: a page read in parts must come from one copy. The shared cache
 * entry cannot promise that: its write lands after the response, a KV read
 * may serve an older copy for up to a minute, and another call can replace
 * it. So a page that needs more than one part is also stored under its own
 * version key, written before the first part returns, and later parts that
 * name the version read exactly that copy.
 */
import { sha256Hex } from "../http/url.js";
import type { CacheContext, SharedCache } from "../cache/shared.js";
import type { FetchedPage } from "../providers/types.js";
import { PinSpace } from "./spaces.js";

export interface Pinned {
  page: FetchedPage;
  provider: string;
}

/** A short id for one copy of a page: changes whenever anything returned changes. */
export async function pageVersion(page: FetchedPage): Promise<string> {
  const digest = await sha256Hex(JSON.stringify([page.finalUrl, page.status, page.title ?? null, page.content]));
  return digest.slice(0, 16);
}

export class PagePins {
  constructor(
    private readonly cache: SharedCache,
    private readonly ttlSeconds: number,
  ) {}

  /**
   * Store this copy under its version, unless it is already there (a version
   * names one exact copy, and KV takes one write a second per key). Awaited,
   * never deferred: the next part may be asked for right away.
   */
  async pin(pageId: string, page: FetchedPage, provider: string, ctx?: CacheContext): Promise<string> {
    const version = await pageVersion(page);
    if (await this.cache.read(PinSpace, `${pageId}:${version}`, ctx)) return version;
    const now = ctx ? { telemetry: ctx.telemetry, parent: ctx.parent } : undefined;
    await this.cache.write(PinSpace, `${pageId}:${version}`, page, this.ttlSeconds, now, provider);
    return version;
  }

  /** The copy with this version, if it is still stored. */
  async recall(pageId: string, version: string, ctx?: CacheContext): Promise<Pinned | undefined> {
    const entry = await this.cache.read(PinSpace, `${pageId}:${version}`, ctx);
    return entry ? { page: entry.value, provider: entry.provider ?? "" } : undefined;
  }
}
