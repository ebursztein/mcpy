/**
 * Njuškalo (hr) and Bolha (si), one classifieds platform. Probed 2026-11-22
 * through tools.ly.tl: a plain fetch of /search/?keywords= serves the page
 * with the search state in window.__INITIAL_STATE__ at searchPage.pageData:
 * promotedListings (paid placement, marked promoted) then regularListings
 * (25 a page). latestListings is a "latest ads" sidebar, not results.
 * sort=new|cheap|expensive and price[min]/price[max] are applied by the
 * site (checked on Bolha: every row >= the floor, createdAt descending).
 * Njuškalo sometimes answers with a ShieldSquare captcha instead.
 */

import type { Country, Language } from "../../../services/common.js";
import type { Marketplace } from "../../../services/shopping/marketplace.js";
import { Condition, ListingFormat, ShoppingSort } from "../../../services/shopping/schema.js";
import { looksBlocked } from "../../readers/html.js";
import { assigned, pick } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";
import { blocked, redesigned } from "./outcome.js";

const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "new",
  [ShoppingSort.PriceLow]: "cheap",
  [ShoppingSort.PriceHigh]: "expensive",
  [ShoppingSort.Relevance]: "relevance",
};

/** The results type of a real match; anything else is the site's filler. */
const REGULAR = "regularListings";

/** "novo", "rabljeno", "neispravno"... in Croatian and Slovenian. */
function condition(value: string | undefined): Condition | undefined {
  if (!value) return undefined;
  if (/^nov/i.test(value)) return Condition.New;
  if (/neispr|okvar|za dijelove|za dele|pokvar/i.test(value)) return Condition.ForParts;
  if (/rablj|korišt|upotreb/i.test(value)) return Condition.Used;
  return undefined;
}

function row(item: Record<string, unknown>, host: string, country: Country, promoted: boolean): RawListing | undefined {
  const path = str(item["url"], 2_000);
  if (!path) return undefined;
  const cond = str(item["condition"]);
  const owner = item["owner"] as Record<string, unknown> | undefined;
  const store = owner?.["isStore"] === true || item["isOwnerResidentialSeller"] === false;
  return {
    url: new URL(path, `https://${host}`).href,
    id: str(item["id"]),
    title: str(item["title"]),
    price: item["isPriceOnRequest"] === true || item["hidePrice"] === true ? undefined : str(item["priceFormatted"]),
    format: ListingFormat.FixedPrice,
    condition: condition(cond),
    postedAt: str(item["createdAt"]),
    location: str(item["location"]),
    country,
    seller: str(owner?.["profileName"]) ?? str(owner?.["userName"]),
    sellerFeedbackCount: typeof owner?.["numberOfReviewsAsSeller"] === "number" && owner["numberOfReviewsAsSeller"] > 0 ? owner["numberOfReviewsAsSeller"] : undefined,
    promoted,
    image: str(item["image"], 2_000),
    details: { Condition: cond, Seller: store ? "business" : "private", "Online payment": item["isOnlinePaymentEnabled"] === true ? true : undefined },
  };
}

function site(key: Marketplace, host: string, country: Country, language: Language): ShoppingSite {
  return {
    key,
    host,
    country,
    currency: "EUR",
    language,
    kind: SiteKind.Classifieds,
    listingId: (url) => /-oglas-(\d+)\/?$/.exec(url.pathname)?.[1],
    search(sq) {
      const sort = SORTS[sq.sort];
      const price = `${sq.minPrice !== undefined ? `&price%5Bmin%5D=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&price%5Bmax%5D=${Math.ceil(sq.maxPrice)}` : ""}`;
      return {
        url: `https://${host}/search/?keywords=${q(sq.query)}${price}${sort ? `&sort=${sort}` : ""}${sq.page > 1 ? `&page=${sq.page}` : ""}`,
        applies: { sort: sort !== undefined, minPrice: true, maxPrice: true },
      };
    },
    read(page) {
      if (looksBlocked(page.content) || /perfdrive\.com|shieldsquare/i.test(page.finalUrl)) return blocked("captcha page");
      const data = pick(assigned(page.content, "__INITIAL_STATE__"), ["searchPage", "pageData"]) as Record<string, unknown> | undefined;
      if (!data) return redesigned("no searchPage.pageData in __INITIAL_STATE__");
      const regular = data["regularListings"];
      if (!Array.isArray(regular)) return redesigned("no regularListings in the search state");
      if (data["resultsType"] !== REGULAR) return { kind: "empty" };
      const promoted = Array.isArray(data["promotedListings"]) ? (data["promotedListings"] as Record<string, unknown>[]) : [];
      const rows = [
        ...promoted.map((i) => row(i, host, country, true)),
        ...(regular as Record<string, unknown>[]).map((i) => row(i, host, country, false)),
      ].filter((r): r is RawListing => r !== undefined);
      if (rows.length === 0) return { kind: "empty" };
      const total = typeof data["listingsCount"] === "number" ? data["listingsCount"] : undefined;
      const pages = typeof data["totalPageCount"] === "number" ? data["totalPageCount"] : undefined;
      const current = Number(new URL(page.finalUrl).searchParams.get("page") ?? "1");
      return { kind: "results", rows, total, hasMore: pages !== undefined && current < pages };
    },
  };
}

export const njuskalo = site("njuskalo", "www.njuskalo.hr", "hr", "hr");
export const bolha = site("bolha", "www.bolha.com", "si", "sl");
