/**
 * Sbazar.cz (Seznam). Probed 2026-11-22 through tools.ly.tl: the search page
 * is an Astro app whose rows sit in serialized island props, but the JSON API
 * the page itself calls answers a plain GET from Cloudflare:
 * /api/v1/items/search?phrase=&offset=&limit=&sort=&price_from=&price_to=.
 * price_from/price_to are applied by the site (checked: every priced row in
 * range; "price by agreement" rows stay, with no price). sort=-create_date is
 * newest first, price / -price the price orders. Times have no offset
 * (Prague local). An unknown phrase answers {"results":[],"total":0}.
 */

import { ListingFormat, ListingStatus, ShoppingSort } from "../../../services/shopping/schema.js";
import { bodyJson, pick } from "../../readers/json.js";
import { looksBlocked } from "../../readers/html.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";
import { cetTime } from "./cet.js";

const PAGE_SIZE = 60;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "-create_date",
  [ShoppingSort.PriceLow]: "price",
  [ShoppingSort.PriceHigh]: "-price",
};

function row(item: Record<string, unknown>): RawListing | undefined {
  const seo = str(item["seo_name"]);
  if (!seo) return undefined;
  const byAgreement = item["price_by_agreement"] === true;
  const locality = item["locality"] as Record<string, unknown> | undefined;
  const image = str(pick(item, ["images", 0, "url"]), 2_000);
  return {
    url: `https://www.sbazar.cz/inzerat/${seo}`,
    id: str(item["id"]),
    title: str(item["name"]),
    price: byAgreement ? undefined : (item["price"] as number | undefined),
    currency: byAgreement ? undefined : "CZK",
    format: byAgreement ? undefined : ListingFormat.FixedPrice,
    status: item["is_reserved"] === true ? ListingStatus.Reserved : undefined,
    postedAt: cetTime(str(item["create_date"])),
    location: [str(locality?.["municipality"]), str(locality?.["district"])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || undefined,
    country: "cz",
    seller: str(pick(item, ["user", "user_service", "shop_url"])),
    promoted: item["topped"] === true,
    // The image host answers 401 without a resize spec; this is the one the site's own cards use.
    image: image ? `${image}?fl=exf|res,606,606,3|webp,75` : undefined,
    details: {
      Category: str(pick(item, ["category", "name"])),
      Price: byAgreement ? "Dohodou" : undefined,
      "Buyer protection": item["buyer_protection"] === true ? true : undefined,
    },
  };
}

export const sbazar: ShoppingSite = {
  key: "sbazar",
  host: "www.sbazar.cz",
  country: "cz",
  currency: "CZK",
  language: "cs",
  kind: SiteKind.Classifieds,
  listingId: (url) => /^\/inzerat\/(\d+)(?:-|$)/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&price_from=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&price_to=${Math.ceil(sq.maxPrice)}` : ""}`;
    return {
      url: `https://www.sbazar.cz/api/v1/items/search?phrase=${q(sq.query)}&offset=${(sq.page - 1) * PAGE_SIZE}&limit=${PAGE_SIZE}${sort ? `&sort=${sort}` : ""}${price}`,
      applies: { sort: sort !== undefined || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const body = bodyJson(page.content) as Record<string, unknown> | undefined;
    const results = body?.["results"];
    if (!Array.isArray(results)) return { kind: "failed", failure: "redesigned", detail: "no results array in the search API answer" };
    if (results.length === 0) return { kind: "empty" };
    const total = pick(body, ["pagination", "total"]);
    const offset = pick(body, ["pagination", "offset"]);
    const rows = (results as Record<string, unknown>[]).map(row).filter((r): r is RawListing => r !== undefined);
    return {
      kind: "results",
      rows,
      total: typeof total === "number" ? total : undefined,
      hasMore: typeof total === "number" && typeof offset === "number" ? offset + results.length < total : results.length === PAGE_SIZE,
    };
  },
};
