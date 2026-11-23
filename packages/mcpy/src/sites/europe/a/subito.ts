/**
 * Subito.it. Probed 2026-11-22 through tools.ly.tl: a plain fetch serves the
 * search page; rows are in __NEXT_DATA__ at
 * props.pageProps.initialState.items.originalList (30 a page). galleryList
 * holds the paid "vetrina" carousel, unrelated to the query: never read.
 * order=datedesc|priceasc|pricedesc and o=N are applied by the site; ps/pe
 * (price) are ignored across all categories (checked: filters stay {} and
 * rows below the floor come back), so mcpy applies the price. Subito matches
 * any query word ("black lotus" returns a Lotus Elise), so rows must contain
 * every word in title or body. Times are Italian local time.
 */

import { Condition, ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { looksBlocked } from "../../readers/html.js";
import { nextData, pick } from "../../readers/json.js";
import { plus, str } from "../../readers/values.js";
import type { RawListing, ShoppingSite } from "../../types.js";
import { cetTime, relevant, Relevance } from "./shared.js";

const PAGE_SIZE = 30;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "datedesc",
  [ShoppingSort.PriceLow]: "priceasc",
  [ShoppingSort.PriceHigh]: "pricedesc",
  [ShoppingSort.Relevance]: "relevance",
};

type Obj = Record<string, unknown>;

/** A feature's first value: key (machine) and value (label). */
function feature(item: Obj, uri: string): { key?: string; value?: string } {
  const v = pick(item, ["features", uri, "values", 0]) as Obj | undefined;
  return { key: str(v?.["key"]), value: str(v?.["value"]) };
}

function condition(label: string | undefined): Condition | undefined {
  if (!label) return undefined;
  if (/^nuovo/i.test(label)) return Condition.New;
  if (/^danneggiato|non funzionante|per ricambi/i.test(label)) return Condition.ForParts;
  return Condition.Used;
}

function row(item: Obj): RawListing | undefined {
  const url = str(pick(item, ["urls", "default"]), 2_000);
  if (!url) return undefined;
  const cond = feature(item, "/item_condition").value;
  const price = feature(item, "/price").key;
  const ship = feature(item, "/item_shipping_cost_tuttosubito").key;
  const advertiser = (item["advertiser"] ?? {}) as Obj;
  const typeKey = str(pick(item, ["type", "key"]));
  const city = str(pick(item, ["geo", "town", "value"])) ?? str(pick(item, ["geo", "city", "value"]));
  return {
    url,
    title: str(item["subject"]),
    description: str(item["body"], 1_200),
    price,
    currency: "EUR",
    format: typeKey === "k" ? ListingFormat.Wanted : ListingFormat.FixedPrice,
    shipping: ship,
    condition: condition(cond),
    postedAt: cetTime(item["date"]),
    location: city,
    country: "it",
    seller: str(advertiser["name"]),
    promoted: pick(item, ["visibilityOptions", "gallery"]) === true,
    image: str(pick(item, ["images", 0, "cdnBaseUrl"]), 2_000),
    details: {
      Category: str(pick(item, ["category", "label"])),
      Condition: cond,
      Seller: advertiser["company"] === true ? "professional" : advertiser["company"] === false ? "private" : undefined,
      Shippable: feature(item, "/item_shippable").key === "1" ? true : undefined,
    },
  };
}

export const subito: ShoppingSite = {
  key: "subito",
  host: "www.subito.it",
  country: "it",
  currency: "EUR",
  language: "it",
  kind: "classifieds",
  listingId: (url) => /^\/[a-z-]+\/[^/]*-(\d{6,})\.htm$/.exec(url.pathname)?.[1],
  search(sq) {
    const order = SORTS[sq.sort];
    return {
      url: `https://www.subito.it/annunci-italia/vendita/usato/?q=${plus(sq.query)}${order ? `&order=${order}` : ""}${sq.page > 1 ? `&o=${sq.page}` : ""}`,
      applies: { sort: order !== undefined },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const items = pick(nextData(page.content), ["props", "pageProps", "initialState", "items"]) as Obj | undefined;
    if (!items || !Array.isArray(items["originalList"])) return { kind: "failed", failure: "redesigned", detail: "no items.originalList in __NEXT_DATA__" };
    const list = (items["originalList"] as Obj[]).filter((i) => i["kind"] === "AdItem");
    const hits = relevant(sq.query, list, (i) => [str(i["subject"]), str(i["body"], 5_000)], Relevance.Row);
    if (hits.length === 0) return { kind: "empty" };
    const rows = hits.map(row).filter((r): r is RawListing => r !== undefined);
    // The site's total counts the rows that match only some words.
    const total = hits.length === list.length && typeof items["total"] === "number" ? items["total"] : undefined;
    return { kind: "results", rows, total, hasMore: list.length >= PAGE_SIZE };
  },
};
