/**
 * Milanuncios (Spain). Probed 2026-11-22: www.milanuncios.com/anuncios/
 * answers Imperva's "Pardon Our Interruption" (HTTP 405) to a plain fetch and
 * also through Firecrawl's stealth proxy. The JSON API the site's search page
 * calls, searchapi.gw.milanuncios.com/v3/classifieds, answers a plain GET
 * from Cloudflare and from a residential IP: ads (default 30), photos,
 * reserve status and totalHits. The default order is newest first (sortDate
 * descending); no price-order parameter was found (orderBy, sort, orden all
 * ignored). priceFrom/priceTo are applied by the API (checked: every row
 * within 50-200; fromPrice/toPrice are ignored). offset pages.
 * transaction "demand" is a buyer's post.
 */

import { Condition, ListingFormat, ListingStatus, ShoppingSort } from "../../../services/shopping/schema.js";
import { bodyJson, pick } from "../../readers/json.js";
import { looksBlocked } from "../../readers/html.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

const PAGE_SIZE = 30;
const CONDITIONS: Readonly<Record<string, Condition>> = {
  BRAND_NEW: Condition.New,
  ALMOST_NEW: Condition.Used,
  GOOD_CONDITION: Condition.Used,
  ACCEPTABLE: Condition.Used,
};

type Obj = Record<string, unknown>;
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

function row(ad: Obj, photos: Map<string, string>, reserved: Set<string>): RawListing | undefined {
  const path = str(ad["url"], 2_000);
  const id = str(ad["id"]);
  if (!path || !id) return undefined;
  const condition = list(ad["attributes"]).find((a) => pick(a, ["field", "raw"]) === "itemCondition");
  const cash = pick(ad, ["price", "cash", "value"]);
  return {
    url: `https://www.milanuncios.com${path}`,
    id,
    title: str(ad["title"]),
    description: str(ad["description"], 1_200),
    price: cash as number | undefined,
    currency: "EUR",
    format: ad["transaction"] === "demand" ? ListingFormat.Wanted : cash !== undefined ? ListingFormat.FixedPrice : undefined,
    condition: CONDITIONS[str(pick(condition, ["value", "raw"])) ?? ""],
    status: reserved.has(id) ? ListingStatus.Reserved : undefined,
    postedAt: str(ad["publicationDate"]),
    location: [str(pick(ad, ["location", "city", "name"])), str(pick(ad, ["location", "province", "name"]))].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || undefined,
    country: "es",
    seller: str(ad["authorName"]),
    promoted: ad["isHighlighted"] === true || (str(ad["visibility"]) !== undefined && ad["visibility"] !== "normal"),
    image: photos.get(id),
    details: {
      Category: list(ad["categories"]).map((c) => str(c["name"])).filter(Boolean).slice(-2).join(" › ") || undefined,
      Condition: str(pick(condition, ["value", "formatted"])),
      Seller: str(ad["type"]),
      Shipping: pick(ad, ["shipping", "shippable"]) === true ? "available" : undefined,
    },
  };
}

export const milanuncios: ShoppingSite = {
  key: "milanuncios",
  // matches descriptions: "black lotus" returned car dealer ads (2026-11-23).
  matchesLoosely: true,
  host: "www.milanuncios.com",
  country: "es",
  currency: "EUR",
  language: "es",
  kind: SiteKind.Classifieds,
  listingId: (url) => /-(\d+)\.htm$/.exec(url.pathname)?.[1],
  search(sq) {
    const price = `${sq.minPrice !== undefined ? `&priceFrom=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&priceTo=${Math.ceil(sq.maxPrice)}` : ""}`;
    return {
      url: `https://searchapi.gw.milanuncios.com/v3/classifieds?text=${q(sq.query)}&limit=${PAGE_SIZE}&offset=${(sq.page - 1) * PAGE_SIZE}${price}`,
      applies: { sort: sq.sort === ShoppingSort.Newest, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "Imperva challenge" };
    const body = bodyJson(page.content) as Obj | undefined;
    if (!body || !Array.isArray(body["ads"])) return { kind: "failed", failure: "redesigned", detail: "no ads array in the search API answer" };
    const ads = body["ads"] as Obj[];
    if (ads.length === 0) return { kind: "empty" };
    const photos = new Map<string, string>();
    for (const p of list(body["photos"])) {
      const first = str(pick(p, ["imageUrls", 0]), 2_000);
      const id = str(p["adId"]);
      // The media host answers 404 without a size rule; detail_640x480 is one it serves.
      if (id && first) photos.set(id, `${first.startsWith("http") ? first : `https://${first}`}?rule=detail_640x480`);
    }
    const reserved = new Set(list(body["status"]).filter((s) => s["reserveStatus"] === "RESERVED").map((s) => String(s["adId"])));
    const rows = ads.map((a) => row(a, photos, reserved)).filter((r): r is RawListing => r !== undefined);
    const total = pick(body, ["pagination", "totalHits", "value"]);
    return { kind: "results", rows, total: typeof total === "number" ? total : undefined, hasMore: typeof total === "number" ? sq.page * PAGE_SIZE < total : ads.length === PAGE_SIZE };
  },
};
