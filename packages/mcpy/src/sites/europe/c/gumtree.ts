/**
 * Gumtree UK. Probed 2026-11-22 through tools.ly.tl: a plain fetch serves the
 * search page; its whole state is URL-encoded JSON in `window.clientData`,
 * with the rows at resultsPage.searchAds (25 a page). resultsPage.nearbyAds
 * (shown when nothing matches) and the JSON-LD ItemList (URLs only) are not
 * used: nearby ads are filler. sort=date is newest first. min_price/max_price
 * are applied only inside a goods category, so searches use
 * search_category=for-sale (checked: every row within 50-300). After a few
 * quick requests from one IP Gumtree answers HTTP 247 with a Reblaze bot
 * check (window.rbzns): read as blocked.
 */

import { Condition, ListingFormat, ListingStatus, ShoppingSort } from "../../../services/shopping/schema.js";
import { balancedJson, parseJson, pick } from "../../readers/json.js";
import { looksBlocked } from "../../readers/html.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";

const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "date",
  [ShoppingSort.PriceLow]: "price_lowest_first",
  [ShoppingSort.PriceHigh]: "price_highest_first",
  [ShoppingSort.Relevance]: "relevance",
};

/** Gumtree's condition labels ("New", "As good as new", "Good condition", "Fair condition", ...). */
function conditionOf(label: string | undefined): Condition | undefined {
  if (!label) return undefined;
  if (/^new$/i.test(label.trim())) return Condition.New;
  if (/parts|not working/i.test(label)) return Condition.ForParts;
  if (/as good as new|good|fair|given it all|used/i.test(label)) return Condition.Used;
  return undefined;
}

const WANTED = /^\s*(buying|wanted|wtb)\b/i;

/** window.clientData = "%7B...%7D" (URL-encoded JSON). */
function clientData(html: string): Record<string, unknown> | undefined {
  const at = html.search(/window\.clientData\s*=\s*"/);
  if (at < 0) return undefined;
  const raw = balancedJson(html, html.indexOf('"', at));
  if (!raw) return undefined;
  try {
    return parseJson(decodeURIComponent(raw.slice(1, -1))) as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
}

function attribute(ad: Record<string, unknown>, key: string): string | undefined {
  const list = Array.isArray(ad["attributes"]) ? (ad["attributes"] as Record<string, unknown>[]) : [];
  return str(list.find((a) => a["key"] === key)?.["value"]);
}

function row(ad: Record<string, unknown>): RawListing | undefined {
  const path = str(ad["path"], 2_000);
  if (!path) return undefined;
  const condition = attribute(ad, "common_for_sale_condition");
  const status = str(ad["status"]);
  return {
    url: path,
    id: str(ad["id"]),
    title: str(ad["title"]),
    description: str(ad["shortDescription"], 1_200),
    price: str(ad["price"]),
    currency: "GBP",
    // Gumtree has no wanted flag; buyers title their posts "Buying ..." / "Wanted ...".
    format: WANTED.test(str(ad["title"]) ?? "") ? ListingFormat.Wanted : undefined,
    condition: conditionOf(condition),
    status: status === "SOLD" ? ListingStatus.SoldOut : undefined,
    postedAt: typeof ad["date"] === "number" ? (ad["date"] as number) : undefined,
    postedText: str(ad["postedDate"]),
    location: str(ad["location"]),
    country: "gb",
    promoted: ad["featured"] === true || ad["bumpup"] === true || ad["urgent"] === true,
    image: str(ad["imageUrl"], 2_000),
    details: { Condition: condition, "Seller type": attribute(ad, "seller_type"), Trade: ad["proAccount"] === true ? true : undefined },
  };
}

export const gumtree: ShoppingSite = {
  key: "gumtree",
  host: "www.gumtree.com",
  country: "gb",
  currency: "GBP",
  language: "en",
  kind: SiteKind.Classifieds,
  listingId: (url) => /^\/p\/[^/]+\/[^/]+\/(\d+)\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&min_price=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&max_price=${Math.ceil(sq.maxPrice)}` : ""}`;
    return {
      url: `https://www.gumtree.com/search?search_category=for-sale&q=${q(sq.query)}${sort ? `&sort=${sort}` : ""}${price}${sq.page > 1 ? `&page=${sq.page}` : ""}`,
      applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
    };
  },
  read(page, sq) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
    // Reblaze bot check: HTTP 247 with a script-only page (window.rbzns, winsocks()).
    if (/window\.rbzns\s*=|winsocks\(\)/.test(page.content)) return { kind: "failed", failure: "blocked", detail: `Reblaze bot check (HTTP ${page.status})` };
    const results = pick(clientData(page.content), ["resultsPage"]) as Record<string, unknown> | undefined;
    const ads = results?.["searchAds"];
    if (!Array.isArray(ads)) return { kind: "failed", failure: "redesigned", detail: "no resultsPage.searchAds in window.clientData" };
    if (ads.length === 0) return { kind: "empty" };
    const rows = (ads as Record<string, unknown>[]).map(row).filter((r): r is RawListing => r !== undefined);
    const total = typeof results!["searchResultAbundance"] === "number" ? (results!["searchResultAbundance"] as number) : undefined;
    const pages = pick(results, ["adsPagination", "numberOfPages"]);
    return { kind: "results", rows, total, hasMore: typeof pages === "number" ? sq.page < pages : undefined };
  },
};
