/**
 * The last resort for an eBay store: a listing API (Serpent's eBay search,
 * $0.0004 a call) stands in when neither the Browse feed nor any page source
 * answered. Its rows lack bids, format, location and seller.
 */

import { ListingSort, type ListingMarket, type ListingPage } from "../../providers/listing-types.js";
import { ShoppingSort } from "../../services/shopping/schema.js";
import type { RawListing, ReadOutcome, ShoppingSite } from "../types.js";
import { conditionOf, ebayItemId } from "./card.js";

const API_SORTS: Record<ShoppingSort, ListingSort> = {
  [ShoppingSort.Newest]: ListingSort.Newest,
  [ShoppingSort.Relevance]: ListingSort.BestMatch,
  [ShoppingSort.PriceLow]: ListingSort.PriceLow,
  [ShoppingSort.PriceHigh]: ListingSort.PriceHigh,
  [ShoppingSort.EndingSoon]: ListingSort.EndingSoon,
};

/** A listing API's rows as this store's rows: the item id makes the URL, on the store's host. */
function readApi(page: ListingPage, host: string, freeShipping: RegExp): ReadOutcome {
  if (!page.rows.length) return { kind: "empty" };
  const rows = page.rows.flatMap((r): RawListing[] => {
    let id = r.id;
    try {
      id ??= ebayItemId(new URL(r.url));
    } catch {
      id = undefined;
    }
    if (!id || !/^\d{9,15}$/.test(id)) return [];
    const shipping = r.shipping && freeShipping.test(r.shipping) ? "free" : r.shipping;
    return [{ url: `https://${host}/itm/${id}`, id, title: r.title, price: r.price?.amount, currency: r.price?.currency, shipping, condition: conditionOf(r.condition), seller: r.seller, image: r.images[0], details: { Condition: r.condition } }];
  });
  return { kind: "results", rows, total: page.total, hasMore: page.hasMore };
}

export function ebayListingApi(market: ListingMarket, host: string, freeShipping: RegExp): NonNullable<ShoppingSite["api"]> {
  return {
    request: (sq) => ({
      listing: { market, query: sq.query, sort: API_SORTS[sq.sort], minPrice: sq.minPrice, maxPrice: sq.maxPrice, page: sq.page },
      applies: { sort: true, minPrice: true, maxPrice: true },
    }),
    read: (page) => readApi(page, host, freeShipping),
  };
}
