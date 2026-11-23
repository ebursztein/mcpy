/**
 * OLX Brasil. Probed 2026-11-22 through tools.ly.tl: a plain fetch serves the
 * search page (no challenge); rows are in the Next.js flight data as the
 * listing component's props {"ads":[...],"searchBoxProps":...}, 50 a page.
 * sf=1 (newest first, the page reports sort "date"), ps/pe (price floor and
 * ceiling) and o (page) are applied by the site: checked live, every row
 * within ps..pe and dates descending. Listing URLs are on regional
 * subdomains (sp.olx.com.br, rj.olx.com.br).
 */

import { Condition, ListingFormat, ShoppingSort } from "../../services/shopping/schema.js";
import { flight, objectsStartingWith, pick } from "../readers/json.js";
import { looksBlocked } from "../readers/html.js";
import { plus, str } from "../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../types.js";

const PAGE_SIZE = 50;

type Ad = Record<string, unknown>;

function property(ad: Ad, name: string): string | undefined {
  const props = Array.isArray(ad["properties"]) ? (ad["properties"] as Ad[]) : [];
  return str(props.find((p) => p["name"] === name)?.["value"]);
}

function conditionOf(value: string | undefined): Condition | undefined {
  if (!value) return undefined;
  if (/^usado/i.test(value)) return Condition.Used;
  if (/^novo/i.test(value)) return Condition.New;
  return undefined;
}

function row(ad: Ad): RawListing | undefined {
  const id = str(ad["listId"]);
  if (!id) return undefined;
  const condition = property(ad, "hobbies_condition") ?? property(ad, "condition");
  return {
    url: str(ad["url"], 2_000),
    id,
    title: str(ad["subject"]),
    price: str(ad["priceValue"]),
    currency: "BRL",
    format: ListingFormat.FixedPrice,
    condition: conditionOf(condition),
    postedAt: typeof ad["date"] === "number" ? ad["date"] : undefined,
    location: str(ad["location"]),
    country: "br",
    seller: str(pick(ad, ["olxPay", "transactionalSellerName"])),
    promoted: ad["fixedOnTop"] === true || ad["isFeatured"] === true,
    image: str(pick(ad, ["images", 0, "original"]), 2_000),
    details: {
      Category: str(ad["categoryName"]),
      Condition: condition,
      Type: property(ad, "hobbies_collections_type"),
      "Professional seller": typeof ad["professionalAd"] === "boolean" ? ad["professionalAd"] : undefined,
      "Old price": str(ad["oldPrice"]),
      "OLX Pay": pick(ad, ["olxPay", "enabled"]) === true ? true : undefined,
    },
  };
}

export const olxBr: ShoppingSite = {
  key: "olx_br",
  host: "www.olx.com.br",
  listingHosts: /^(?:[a-z]{2}\.|www\.)?olx\.com\.br$/,
  country: "br",
  currency: "BRL",
  language: "pt",
  kind: SiteKind.Classifieds,
  listingId: (url) => /-(\d{8,12})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const price = `${sq.minPrice !== undefined ? `&ps=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&pe=${Math.ceil(sq.maxPrice)}` : ""}`;
    const sort = sq.sort === ShoppingSort.Newest ? "&sf=1" : "";
    return {
      url: `https://www.olx.com.br/brasil?q=${plus(sq.query)}${sort}${price}${sq.page > 1 ? `&o=${sq.page}` : ""}`,
      applies: { sort: sq.sort === ShoppingSort.Newest || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    const data = flight(page.content);
    const listing = objectsStartingWith(data, '{"ads":[', 5).find((o) => Array.isArray(o["ads"]) && "searchBoxProps" in o);
    if (!listing) return { kind: "failed", failure: "redesigned", detail: "no ads list in the flight data" };
    const ads = listing["ads"] as Ad[];
    if (ads.length === 0) return { kind: "empty" };
    const total = Number(/\\?"totalOfAds\\?":(\d+)/.exec(data)?.[1] ?? NaN);
    const rows = ads.map(row).filter((r): r is RawListing => r !== undefined);
    return { kind: "results", rows, total: Number.isFinite(total) ? total : undefined, hasMore: Number.isFinite(total) ? total > sq.page * PAGE_SIZE : ads.length >= PAGE_SIZE };
  },
};
