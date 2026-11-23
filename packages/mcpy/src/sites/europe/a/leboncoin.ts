/**
 * leboncoin. Probed 2026-11-22 through tools.ly.tl: the search page is
 * behind DataDome (the plain fetch escalates to a paid source), and its rows
 * are in __NEXT_DATA__ at props.pageProps.searchData.ads (35 a page) with
 * the total beside them. sort=time&order=desc (newest), sort=price&order=asc|desc,
 * price=MIN-MAX and page=N are applied by the site (checked: every row >= the
 * floor, prices ascending on page 2). Rows flagged display_as_alu or
 * sub_toplist are paid placements: kept and marked promoted. Times are Paris
 * local time. A search without results has total 0 and no ads.
 */

import { Condition, ListingFormat, ListingStatus, ShoppingSort } from "../../../services/shopping/schema.js";
import { looksBlocked } from "../../readers/html.js";
import { nextData, pick } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import type { RawListing, ShoppingSite } from "../../types.js";
import { cetTime } from "./shared.js";

const PAGE_SIZE = 35;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "&sort=time&order=desc",
  [ShoppingSort.PriceLow]: "&sort=price&order=asc",
  [ShoppingSort.PriceHigh]: "&sort=price&order=desc",
};

type Obj = Record<string, unknown>;

function attributes(ad: Obj): Record<string, string> {
  const out: Record<string, string> = {};
  const list = Array.isArray(ad["attributes"]) ? (ad["attributes"] as Obj[]) : [];
  for (const a of list) {
    const key = str(a["key"]);
    const label = str(a["value_label"]) ?? str(a["value"]);
    if (key && label) out[key] = label;
  }
  return out;
}

function condition(label: string | undefined): Condition | undefined {
  if (!label) return undefined;
  if (/^neuf|état neuf/i.test(label) && !/comme neuf|très bon/i.test(label)) return Condition.New;
  if (/pour pièces/i.test(label)) return Condition.ForParts;
  return Condition.Used;
}

/** The cheapest shipping option, in euros. */
function shipping(ad: Obj): number | undefined {
  const fees = Array.isArray(ad["shipping_fees"]) ? (ad["shipping_fees"] as Obj[]) : [];
  const cents = fees.map((f) => f["price"]).filter((p): p is number => typeof p === "number" && p >= 0);
  return cents.length ? Math.min(...cents) / 100 : undefined;
}

function row(ad: Obj): RawListing | undefined {
  const id = str(ad["list_id"]);
  if (!id) return undefined;
  const attrs = attributes(ad);
  const options = (ad["options"] ?? {}) as Obj;
  const owner = (ad["owner"] ?? {}) as Obj;
  const location = (ad["location"] ?? {}) as Obj;
  const price = Array.isArray(ad["price"]) ? ad["price"][0] : undefined;
  const ship = shipping(ad);
  const wanted = ad["ad_type"] === "demand";
  return {
    url: str(ad["url"], 2_000) ?? `https://www.leboncoin.fr/ad/a/${id}`,
    id,
    title: str(ad["subject"]),
    description: str(ad["body"], 1_200),
    price: price as number | undefined,
    currency: "EUR",
    format: wanted ? ListingFormat.Wanted : ListingFormat.FixedPrice,
    shipping: ship === 0 ? "free" : ship,
    condition: condition(attrs["condition"]),
    status: ad["status"] === "active" || ad["status"] === undefined ? ListingStatus.Available : undefined,
    postedAt: cetTime(ad["first_publication_date"]),
    location: str(location["city_label"]) ?? str(location["city"]),
    country: str(location["country_id"])?.toLowerCase() ?? "fr",
    seller: str(owner["name"]),
    sellerFeedbackCount: attrs["rating_count"],
    promoted: options["display_as_alu"] === true || options["sub_toplist"] === true,
    image: str(pick(ad, ["images", "urls", 0]), 2_000) ?? str(pick(ad, ["images", "thumb_url"]), 2_000),
    details: {
      Category: str(ad["category_name"]),
      Condition: attrs["condition"],
      Seller: owner["type"] === "pro" ? "professional" : owner["type"] === "private" ? "private" : undefined,
      Shippable: attrs["shippable"] === "true" ? true : undefined,
    },
  };
}

export const leboncoin: ShoppingSite = {
  key: "leboncoin",
  host: "www.leboncoin.fr",
  country: "fr",
  currency: "EUR",
  language: "fr",
  kind: "classifieds",
  listingId: (url) => /^\/ad\/[a-z_]+\/(\d{6,})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort] ?? "";
    const range = sq.minPrice !== undefined || sq.maxPrice !== undefined ? `&price=${sq.minPrice !== undefined ? Math.floor(sq.minPrice) : "min"}-${sq.maxPrice !== undefined ? Math.ceil(sq.maxPrice) : "max"}` : "";
    return {
      url: `https://www.leboncoin.fr/recherche?text=${q(sq.query)}${sort}${range}${sq.page > 1 ? `&page=${sq.page}` : ""}`,
      applies: { sort: sort !== "" || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const data = pick(nextData(page.content), ["props", "pageProps", "searchData"]) as Obj | undefined;
    if (!data) return { kind: "failed", failure: "redesigned", detail: "no searchData in __NEXT_DATA__" };
    const ads = Array.isArray(data["ads"]) ? (data["ads"] as Obj[]) : [];
    if (ads.length === 0) return { kind: "empty" };
    const total = typeof data["total"] === "number" ? data["total"] : undefined;
    const rows = ads.map(row).filter((r): r is RawListing => r !== undefined);
    return { kind: "results", rows, total, hasMore: ads.length >= PAGE_SIZE };
  },
};
