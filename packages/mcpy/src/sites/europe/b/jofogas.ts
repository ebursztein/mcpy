/**
 * Jófogás (hu). Probed 2026-11-22: from Cloudflare IPs (tools.ly.tl) the site
 * answers 202 with an AWS WAF JavaScript challenge; from a residential IP a
 * plain fetch serves the page with rows in __NEXT_DATA__ at
 * props.pageProps.adList.ads (36 a page). min_price/max_price and sp
 * (1 cheapest, 2 dearest, 3 newest) are applied by the site (checked: every
 * row >= the floor, list_time descending). adList.query_feedback.mode is
 * "exact" for real matches and "none" for no results; any other mode is the
 * site's loosened filler and is not a result.
 */

import { Condition, ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { looksBlocked } from "../../readers/html.js";
import { nextData, pick } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";
import { blocked, redesigned } from "./outcome.js";

const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "3",
  [ShoppingSort.PriceLow]: "1",
  [ShoppingSort.PriceHigh]: "2",
};
const PAGE_SIZE = 36;
/** type.value of a buyer's post ("Keres"). */
const WANTED = "k";
const EXACT = "exact";
const NONE = "none";

type Obj = Record<string, unknown>;

function parameter(ad: Obj, test: (key: string) => boolean): string | undefined {
  const params = Array.isArray(ad["parameters"]) ? (ad["parameters"] as Obj[]) : [];
  const p = params.find((x) => typeof x["key"] === "string" && test(x["key"]));
  return str(pick(p, ["values", 0, "label"]));
}

function condition(label: string | undefined): Condition | undefined {
  if (!label) return undefined;
  if (/^új$/i.test(label)) return Condition.New;
  if (/sérült|hibás|alkatrész/i.test(label)) return Condition.ForParts;
  if (/használt|újszerű|hibátlan|korának|restaurált/i.test(label)) return Condition.Used;
  return undefined;
}

function row(ad: Obj): RawListing | undefined {
  const url = str(ad["url"], 2_000);
  if (!url) return undefined;
  const cond = parameter(ad, (k) => k.includes("condition"));
  const city = parameter(ad, (k) => k === "city");
  const region = str(pick(ad, ["region", "label"]));
  const image = str(pick(ad, ["images", 0, "name"]), 500);
  const company = ad["company_ad"] === true;
  return {
    url,
    id: str(ad["list_id"]),
    title: str(ad["subject"]),
    description: str(ad["body"], 1_200),
    price: pick(ad, ["price", "value"]) as number | undefined,
    currency: "HUF",
    format: pick(ad, ["type", "value"]) === WANTED ? ListingFormat.Wanted : ListingFormat.FixedPrice,
    condition: condition(cond),
    postedAt: str(pick(ad, ["list_time", "value"])),
    location: [city, region].filter(Boolean).join(", ") || undefined,
    country: "hu",
    seller: str(pick(ad, ["profileData", "company_name"])) ?? str(pick(ad, ["profileData", "user_name"])),
    promoted: ad["paid_position"] === true,
    image: image ? `https://img.jofogas.hu/620x620aspect/${encodeURIComponent(image)}` : undefined,
    details: {
      Condition: cond,
      Seller: company ? "business" : "private",
      Category: Array.isArray(ad["category_tree"]) ? str((ad["category_tree"] as Obj[]).at(-1)?.["name"]) : undefined,
      Shipping: Array.isArray(ad["badges"]) && (ad["badges"] as Obj[]).some((b) => b["type"] === "d2d_available") ? "available" : undefined,
    },
  };
}

export const jofogas: ShoppingSite = {
  key: "jofogas",
  host: "www.jofogas.hu",
  country: "hu",
  currency: "HUF",
  language: "hu",
  kind: SiteKind.Classifieds,
  listingId: (url) => /_(\d{6,})\.htm$/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&min_price=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&max_price=${Math.ceil(sq.maxPrice)}` : ""}`;
    return {
      url: `https://www.jofogas.hu/magyarorszag?q=${q(sq.query)}${price}${sort ? `&sp=${sort}` : ""}${sq.page > 1 ? `&o=${sq.page}` : ""}`,
      applies: { sort: sort !== undefined || sq.sort === ShoppingSort.Relevance, minPrice: true, maxPrice: true },
    };
  },
  read(page) {
    if (looksBlocked(page.content) || /awsWafCookieDomainList|AwsWafIntegration/.test(page.content)) return blocked("AWS WAF challenge");
    const list = pick(nextData(page.content), ["props", "pageProps", "adList"]) as Obj | undefined;
    if (!list) return redesigned("no adList in __NEXT_DATA__");
    const mode = pick(list, ["query_feedback", "mode"]);
    const ads = list["ads"];
    // The no-results page has no "ads" key at all, only query_feedback.mode "none" and search_total 0.
    if (!Array.isArray(ads)) return mode === NONE || list["search_total"] === 0 ? { kind: "empty" } : redesigned("no adList.ads in __NEXT_DATA__");
    if (ads.length === 0 || (mode !== undefined && mode !== EXACT)) return { kind: "empty" };
    const rows = (ads as Obj[]).map(row).filter((r): r is RawListing => r !== undefined);
    const total = typeof list["search_total"] === "number" ? list["search_total"] : undefined;
    const current = pick(list, ["pager", "current_page"]);
    const last = pick(list, ["pager", "last_page"]);
    return { kind: "results", rows, total, hasMore: typeof current === "number" && typeof last === "number" ? current < last : ads.length === PAGE_SIZE };
  },
};
