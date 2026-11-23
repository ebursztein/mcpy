/**
 * shopping_item: one listing page read with the site's item reader, or the
 * default JSON-LD Product reader. Card marketplaces are refused: their
 * listing URL is a product page shared by every seller, so no single offer
 * can be read from it.
 */

import { ErrorCode } from "../../enums.js";
import { McpyError } from "../../errors.js";
import type { CallScope, Engine } from "../../engine/engine.js";
import { absoluteUrl, normalize } from "../../sites/normalize.js";
import { readItemPage } from "../../sites/readers/item.js";
import { fetchAndRead } from "./fetch-site.js";
import { ShoppingItemResultSchema, type ShoppingItemResult } from "./schema.js";
import { combined, siteForUrl, type Op } from "./service.js";

export async function shoppingItemOp(engine: Engine, input: { url: string; max_age: number }, scope: CallScope): Op<ShoppingItemResult> {
  const startedAt = Date.now();
  const site = siteForUrl(input.url);
  if (!site) throw new McpyError(ErrorCode.InvalidInput, "not a listing on a supported shopping site", ["pass a url from shopping_search"]);
  if (site.product && !site.item) {
    throw new McpyError(ErrorCode.InvalidInput, "this site's listings are offers on a shared product page; shopping_search already returns every offer's fields", [
      "use the listing from shopping_search",
    ]);
  }
  const req = site.item?.request(input.url) ?? { url: input.url };
  const got = await fetchAndRead(engine, site, req, (p) => (site.item ? site.item.read(p) : readItemPage(p)), scope, input.max_age);
  const outcome = got.outcome;
  if (outcome.kind !== "results" || !outcome.rows[0]) {
    const why = outcome.kind === "failed" ? `${outcome.failure}: ${outcome.detail}` : "no listing on the page";
    throw new McpyError(ErrorCode.UpstreamFailed, `could not read the listing (${why})`);
  }
  const base = got.finalUrl ?? input.url;
  const r0 = outcome.rows[0];
  const listing = normalize(site, { ...r0, url: r0.url ?? input.url, details: undefined }, base);
  if (!listing) throw new McpyError(ErrorCode.UpstreamFailed, "the page is not a listing on this site");
  // Every field is checked on its own: one bad image or detail never fails the call.
  const images = [...new Set((r0.images ?? []).map((u) => absoluteUrl(u, base)).filter((u): u is string => !!u))].slice(0, 24);
  const details = Object.fromEntries(
    Object.entries(r0.details ?? {})
      .filter(([k, v]) => k.trim() && v !== null && v !== undefined && String(v).trim())
      .map(([k, v]) => [k.trim().slice(0, 100), String(v).trim().slice(0, 500)]),
  );
  const served = got.served ?? combined([]);
  const result = ShoppingItemResultSchema.parse({
    ...listing,
    description: typeof r0.description === "string" && r0.description.trim() ? r0.description.slice(0, 10_000) : undefined,
    images: images.length ? images : undefined,
    details: Object.keys(details).length ? details : undefined,
    observed_at: new Date().toISOString(),
    meta: { cache: served.cache, latency_ms: Date.now() - startedAt, attempts: served.attempts },
  });
  return { result, served, outputChars: JSON.stringify(result).length };
}
