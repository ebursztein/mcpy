/**
 * magi (trading-card marketplace). Probed 2026-11-22: a plain fetch serves
 * the server-rendered listing search (/items/search); each div.item-list__box
 * is one seller's listing (/items/{id}) with its price. There is no JSON.
 * Applied by the site (checked on the live site): forms_search_items[sort]
 * (price_asc gave ascending prices; price_minimum_updated_at_desc is its
 * "newest" order, by last update), from_price/to_price (every row inside the
 * range) and page. status=presented asks for listings still for sale; a sold
 * row that still shows is marked sold_out. Buyers' "wanted" posts (求/買取 in
 * the title) carry a placeholder price: format wanted, no price.
 */

import { SiteFailure } from "../../services/common.js";
import { ListingFormat, ListingStatus, ShoppingSort } from "../../services/shopping/schema.js";
import { attr, blocks, first, looksBlocked, text } from "../readers/html.js";
import { q } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";

const ORIGIN = "https://magi.camp";
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "price_minimum_updated_at_desc",
  [ShoppingSort.PriceLow]: "price_asc",
  [ShoppingSort.PriceHigh]: "price_desc",
};
/** A buyer's post: 【求】, 求む, 買取, 買います, 募集 at the start of the title. */
const WANTED = /^\s*(?:[【\[(（]\s*(?:求|買取|買います|募集)[^】\])）]*[】\])）]|求む|求)/;

const param = (name: string, value: string | number) => `&forms_search_items%5B${name}%5D=${q(String(value))}`;

function row(box: string): RawListing | undefined {
  const id = first(box, /href="\/items\/(\d+)"/);
  if (!id) return undefined;
  const title = text(first(box, /<div class="item-list__item-name">([\s\S]*?)<\/div>/));
  const wanted = WANTED.test(title ?? "");
  const certified = /alt="認定出品者"/.test(box);
  return {
    url: `${ORIGIN}/items/${id}`,
    id,
    title,
    price: wanted ? undefined : text(first(box, /item-list__price-box--price">([\s\S]*?)<\/li>/)),
    currency: "JPY",
    format: wanted ? ListingFormat.Wanted : ListingFormat.FixedPrice,
    status: /item-list__sold-icon/.test(box) ? ListingStatus.SoldOut : ListingStatus.Available,
    image: attr(first(box, /(<img [^>]*class="lozad[^"]*"[^>]*>)/), "data-src"),
    country: "jp",
    details: { "Certified seller": certified ? true : undefined, Favorites: text(first(box, /favorite-number"><img[^>]*>([\d,]+)</)) },
  };
}

export const magi: ShoppingSite = {
  key: "magi",
  host: "magi.camp",
  country: "jp",
  currency: "JPY",
  language: "ja",
  kind: SiteKind.Marketplace,
  listingId: (url) => /^\/items\/(\d+)$/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? param("from_price", Math.floor(sq.minPrice)) : ""}${sq.maxPrice !== undefined ? param("to_price", Math.ceil(sq.maxPrice)) : ""}`;
    return {
      url: `${ORIGIN}/items/search?${param("keyword", sq.query).slice(1)}${sort ? param("sort", sort) : ""}${price}${param("status", "presented")}${sq.page > 1 ? `&page=${sq.page}` : ""}`,
      applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" };
    const rows = blocks(page.content, /<div class="item-list__box /)
      .map(row)
      .filter((r): r is RawListing => r !== undefined);
    const total = first(page.content, /出品一覧\(([\d,]+)件\)/);
    if (rows.length) return { kind: "results", rows, total: total ? Number(total.replace(/,/g, "")) : undefined, hasMore: page.content.includes(`page=${sq.page + 1}"`) };
    if (/該当する出品がありませんでした/.test(page.content)) return { kind: "empty" };
    return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no item-list rows" };
  },
};
