/**
 * Default item-page reader for shopping_item: the schema.org Product in the
 * page's JSON-LD (most shops and classifieds publish one for search engines).
 * Sites with a better source define their own `item` reader.
 */

import { Condition, ListingStatus, type Condition as Cond, type ListingStatus as Status } from "../../services/shopping/schema.js";
import type { RawListing, ReadOutcome, SitePage } from "../types.js";
import { jsonLd, looksBlocked } from "./html.js";
import { str } from "./values.js";

const CONDITIONS: Readonly<Record<string, Cond>> = {
  NewCondition: Condition.New,
  UsedCondition: Condition.Used,
  RefurbishedCondition: Condition.Refurbished,
  DamagedCondition: Condition.ForParts,
};

const STATUSES: Readonly<Record<string, Status>> = {
  InStock: ListingStatus.Available,
  LimitedAvailability: ListingStatus.Available,
  OnlineOnly: ListingStatus.Available,
  OutOfStock: ListingStatus.SoldOut,
  SoldOut: ListingStatus.SoldOut,
  Discontinued: ListingStatus.SoldOut,
};

const tail = (v: unknown): string | undefined => str(v)?.split("/").pop();

function images(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v];
  return list.map((x) => (typeof x === "string" ? x : str((x as Record<string, unknown> | undefined)?.["url"], 2_000))).filter((x): x is string => !!x);
}

export function readItemPage(page: SitePage): ReadOutcome {
  if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
  const product = jsonLd(page.content, "Product")[0];
  if (!product) return { kind: "failed", failure: "redesigned", detail: "no schema.org Product on the page" };
  const offers = product["offers"];
  const offer = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown> | undefined;
  const seller = offer?.["seller"] as Record<string, unknown> | undefined;
  const pics = images(product["image"]);
  const row: RawListing = {
    url: str(offer?.["url"], 4_000) ?? str(product["url"], 4_000) ?? page.finalUrl,
    id: str(product["sku"]) ?? str(product["productID"]),
    title: str(product["name"]),
    description: str(product["description"], 10_000),
    price: (offer?.["price"] ?? offer?.["lowPrice"]) as number | string | undefined,
    currency: str(offer?.["priceCurrency"]),
    condition: CONDITIONS[tail(offer?.["itemCondition"] ?? product["itemCondition"]) ?? ""],
    status: STATUSES[tail(offer?.["availability"]) ?? ""],
    seller: str(seller?.["name"]),
    image: pics[0],
    images: pics,
    details: { Brand: str((product["brand"] as Record<string, unknown> | undefined)?.["name"] ?? product["brand"]), SKU: str(product["sku"]), GTIN: str(product["gtin13"] ?? product["gtin"]) },
  };
  return { kind: "results", rows: [row] };
}
