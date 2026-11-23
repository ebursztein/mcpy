/**
 * dubizzle Dubai. Probed 2026-11-22: a residential plain fetch gets the
 * Imperva "Pardon Our Interruption" page; through tools.ly.tl the search page
 * comes back (sometimes after a paid escalation). The rows are in
 * __NEXT_DATA__: props.pageProps.reduxWrapperActionsGIPP holds the Redux
 * actions the server ran, and the "listings/fetchListingDataForQuery/
 * fulfilled" payload carries hits (25 a page) and pagination; its
 * promotedAds/cotwListings are not search results and are not read. The
 * default order is newest first (checked: hits by `added` descending); the
 * sort parameter is ignored (price_asc came back in default order).
 * price__gte/price__lte are applied by the site (checked: every row within
 * 100-1000). page is 1-based in the URL, 0-based in the payload.
 */

import { Condition, ShoppingSort } from "../../../services/shopping/schema.js";
import { nextData, pick } from "../../readers/json.js";
import { looksBlocked } from "../../readers/html.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

const CONDITIONS: Readonly<Record<string, Condition>> = { "brand new": Condition.New };

const en = (v: unknown): string | undefined => str(pick(v, ["en"])) ?? str(v);

function detail(hit: Record<string, unknown>, name: string): string | undefined {
  return str(pick(hit, ["details", name, "en", "value"]));
}

function row(hit: Record<string, unknown>): RawListing | undefined {
  const url = en(hit["absolute_url"]);
  if (!url) return undefined;
  const age = detail(hit, "Age");
  const places = pick(hit, ["location_list", "en"]);
  return {
    url,
    id: str(hit["uuid"]),
    title: en(hit["name"]),
    price: hit["price"] as number | undefined,
    currency: "AED",
    condition: age ? (CONDITIONS[age.toLowerCase()] ?? Condition.Used) : undefined,
    postedAt: typeof hit["added"] === "number" ? (hit["added"] as number) : undefined,
    location: Array.isArray(places) ? (places as unknown[]).slice(1).map((p) => str(p)).filter(Boolean).join(", ") || undefined : undefined,
    country: "ae",
    promoted: hit["is_premium"] === true || hit["is_super_ad"] === true || (typeof hit["highlighted_ad"] === "number" && hit["highlighted_ad"] > 0),
    image: str(pick(hit, ["photos", "main"]), 2_000) ?? str(pick(hit, ["photo_thumbnails", 0]), 2_000),
    details: {
      Category: Array.isArray(pick(hit, ["category", "en"])) ? ((pick(hit, ["category", "en"]) as unknown[]).map((c) => str(c)).filter(Boolean).join(" › ") || undefined) : undefined,
      Age: age,
      Condition: detail(hit, "Condition"),
      Usage: detail(hit, "Usage"),
      "Verified user": hit["is_verified_user"] === true ? true : undefined,
    },
  };
}

function listingPayload(html: string): Record<string, unknown> | undefined {
  const actions = pick(nextData(html), ["props", "pageProps", "reduxWrapperActionsGIPP"]);
  if (!Array.isArray(actions)) return undefined;
  const hit = (actions as Record<string, unknown>[]).find((a) => a["type"] === "listings/fetchListingDataForQuery/fulfilled");
  return hit?.["payload"] as Record<string, unknown> | undefined;
}

export const dubizzleAe: ShoppingSite = {
  key: "dubizzle_ae",
  host: "dubai.dubizzle.com",
  country: "ae",
  currency: "AED",
  language: "en",
  kind: SiteKind.Classifieds,
  listingId: (url) => /---([0-9a-f]{32})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const price = `${sq.minPrice !== undefined ? `&price__gte=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&price__lte=${Math.ceil(sq.maxPrice)}` : ""}`;
    return {
      url: `https://dubai.dubizzle.com/search/?keyword=${q(sq.query)}${price}${sq.page > 1 ? `&page=${sq.page}` : ""}`,
      applies: { sort: sq.sort === ShoppingSort.Newest, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const payload = listingPayload(page.content);
    if (!payload || !Array.isArray(payload["hits"])) return { kind: "failed", failure: "redesigned", detail: "no fetchListingDataForQuery hits in __NEXT_DATA__" };
    const hits = payload["hits"] as Record<string, unknown>[];
    if (hits.length === 0) return { kind: "empty" };
    const rows = hits.map(row).filter((r): r is RawListing => r !== undefined);
    const total = pick(payload, ["pagination", "totalHits"]);
    const current = pick(payload, ["pagination", "page"]);
    const pages = pick(payload, ["pagination", "totalPages"]);
    return {
      kind: "results",
      rows,
      total: typeof total === "number" ? total : undefined,
      hasMore: typeof current === "number" && typeof pages === "number" ? current + 1 < pages : undefined,
    };
  },
};
