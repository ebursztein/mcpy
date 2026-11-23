/**
 * Ricardo (CH), auctions and buy-now. Probed 2026-11-22 through tools.ly.tl:
 * the search page is Next app-router; its rows are the "articles" array in
 * the flight data (60 a page) next to totalArticlesCount. The JSON-LD
 * ItemList carries names only. sort=newest, range_filters.price.min/max and
 * page=N are applied by the site (checked: prices inside the range, newest
 * first, "Seite 2" served). Other sort values were not verified and are not
 * sent. Rows carry no URL: it is built from the slug in the image URL and the
 * id. Ricardo ranks partial matches ("black lotus" returns Lotus books), so
 * the title must contain every query word.
 */

import { Condition, ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { looksBlocked } from "../../readers/html.js";
import { balancedJson, flight, parseJson } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import type { RawListing, ShoppingSite } from "../../types.js";
import { relevant, Relevance } from "./shared.js";

const PAGE_SIZE = 60;

type Obj = Record<string, unknown>;

const CONDITIONS: Partial<Record<string, Condition>> = {
  new: Condition.New,
  new_see_description: Condition.New,
  like_new: Condition.Used,
  used: Condition.Used,
  antique: Condition.Used,
  acceptable: Condition.Used,
  defective: Condition.ForParts,
};

/** The cheapest delivery that is not pickup, and the seller's city. */
function shipping(article: Obj): { cost?: number; city?: string } {
  const list = Array.isArray(article["shipping"]) ? (article["shipping"] as Obj[]) : [];
  const costs = list.filter((s) => s["key"] !== "get_by_buyer").map((s) => s["cost"]).filter((c): c is number => typeof c === "number" && c >= 0);
  return { cost: costs.length ? Math.min(...costs) : undefined, city: str(list[0]?.["city"]) };
}

function articleUrl(article: Obj, id: string): string {
  const slug = /\/([a-z0-9-]+)$/.exec(str(article["image"], 2_000) ?? "")?.[1];
  return `https://www.ricardo.ch/de/a/${slug ? `${slug}-` : ""}${id}/`;
}

function row(a: Obj): RawListing | undefined {
  const id = str(a["id"]);
  if (!id) return undefined;
  const auction = a["hasAuction"] === true;
  const buyNow = a["hasBuyNow"] === true ? (a["buyNowPrice"] as number | undefined) : undefined;
  const ship = shipping(a);
  const cond = str(a["conditionKey"]);
  return {
    url: articleUrl(a, id),
    id,
    title: str(a["title"]),
    price: auction ? (a["bidPrice"] as number | undefined) : buyNow,
    currency: "CHF",
    format: auction ? ListingFormat.Auction : a["canMakeAnOffer"] === true ? ListingFormat.BestOffer : ListingFormat.FixedPrice,
    bids: auction ? (a["bidsCount"] as number | undefined) : undefined,
    endsAt: str(a["endDate"]),
    buyNow: auction ? buyNow : undefined,
    shipping: ship.cost === 0 ? "free" : ship.cost,
    condition: cond ? CONDITIONS[cond] : undefined,
    postedAt: str(a["creationDate"]) ?? str(a["startDate"]),
    location: ship.city,
    country: "ch",
    promoted: a["isPromo"] === true,
    image: str(a["image"], 2_000),
    details: { Condition: cond, Brand: str(a["brand"]), "Buyer protection": a["isMoneyGuard"] === true ? true : undefined },
  };
}

/** The search's articles array from the flight data, or undefined when the page has none. */
function articles(html: string): { list: Obj[]; total?: number } | undefined {
  const text = flight(html);
  const at = text.indexOf('"articles":[');
  if (at < 0) return undefined;
  const list = parseJson(balancedJson(text, at + '"articles":'.length) ?? "");
  if (!Array.isArray(list)) return undefined;
  const total = /"totalArticlesCount":(\d+)/.exec(text)?.[1];
  return { list: list as Obj[], total: total ? Number(total) : undefined };
}

export const ricardo: ShoppingSite = {
  key: "ricardo",
  host: "www.ricardo.ch",
  country: "ch",
  currency: "CHF",
  language: "de",
  kind: "auction",
  listingId: (url) => /^\/(?:de|fr|it|en)\/a\/(?:[a-z0-9-]*-)?(\d{6,})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const params = [
      sq.sort === ShoppingSort.Newest ? "sort=newest" : "",
      sq.minPrice !== undefined ? `range_filters.price.min=${sq.minPrice}` : "",
      sq.maxPrice !== undefined ? `range_filters.price.max=${sq.maxPrice}` : "",
      sq.page > 1 ? `page=${sq.page}` : "",
    ].filter(Boolean);
    return {
      url: `https://www.ricardo.ch/de/s/${q(sq.query)}/${params.length ? `?${params.join("&")}` : ""}`,
      applies: { sort: sq.sort === ShoppingSort.Newest || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const found = articles(page.content);
    if (!found) return { kind: "failed", failure: "redesigned", detail: "no articles in the flight data" };
    const hits = relevant(sq.query, found.list, (a) => [str(a["title"])], Relevance.Row);
    if (hits.length === 0) return { kind: "empty" };
    const rows = hits.map(row).filter((r): r is RawListing => r !== undefined);
    return { kind: "results", rows, total: hits.length === found.list.length ? found.total : undefined, hasMore: found.list.length >= PAGE_SIZE };
  },
};
