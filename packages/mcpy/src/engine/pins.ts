/**
 * Page pins: a page read in parts must come from one copy. The shared cache
 * entry cannot promise that: its write lands after the response, a KV read
 * may serve an older copy for up to a minute, and another call can replace
 * it. So a page that needs more than one part is also stored under its own
 * version key, written before the first part returns, and later parts that
 * name the version read exactly that copy.
 */

import { z } from "zod";
import { ContentKindSchema, PageFormatSchema } from "../enums.js";
import { sha256Hex } from "../http/url.js";
import type { FetchedPage } from "../providers/types.js";
import type { Cache } from "./cache.js";

const PIN_VERSION = "v1";

const PinnedSchema = z.object({
  provider: z.string(),
  value: z.object({
    url: z.string(),
    finalUrl: z.string(),
    status: z.number().int(),
    contentType: z.string(),
    kind: ContentKindSchema,
    title: z.string().optional(),
    content: z.string(),
    format: PageFormatSchema,
  }),
});

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
    private readonly cache: Cache,
    private readonly ttlSeconds: number,
  ) {}

  /** Store this copy under its version. Awaited: the next part may be asked for right away. */
  async pin(pageKey: string, page: FetchedPage, provider: string): Promise<string> {
    const version = await pageVersion(page);
    await this.cache.put(key(pageKey, version), { value: page, provider }, this.ttlSeconds);
    return version;
  }

  /** The copy with this version, if it is still stored. */
  async recall(pageKey: string, version: string): Promise<Pinned | undefined> {
    const saved = PinnedSchema.safeParse(await this.cache.get(key(pageKey, version)));
    return saved.success ? { page: saved.data.value, provider: saved.data.provider } : undefined;
  }
}

const key = (pageKey: string, version: string) => `pin:${PIN_VERSION}:${pageKey}:${version}`;
