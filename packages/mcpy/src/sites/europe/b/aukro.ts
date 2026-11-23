/**
 * Aukro (cz), auctions and fixed-price offers. Probed 2026-11-22 through
 * tools.ly.tl: a plain fetch of /vysledky-vyhledavani?text= serves the
 * Angular page whose transfer state (script#ng-state) caches the
 * searchItemsCommon API response: aukCache["POST/backend-web/api/offers/
 * searchItemsCommon..."].b.content (60 a page). The API itself is behind a
 * Cloudflare challenge for direct callers and answers 405 through the
 * deployed fetch, so the page is the source.
 *
 * sort (startingTime:DESC, price:ASC, ...) and priceMin/priceMax are applied
 * by the site on a real search page (checked: startingTime descending, every
 * row >= the floor). But popular words (pokemon, charizard) redirect to a
 * curated landing page (/lp/nejkvalitnejsi-...) that drops every parameter,
 * so `applies` stays unset and mcpy filters and sorts the rows itself.
 * fallbackItems are the site's recommendations, never results.
 */

import { Condition, ListingFormat, ListingStatus, ShoppingSort } from "../../../services/shopping/schema.js";
import { looksBlocked } from "../../readers/html.js";
import { pick, scriptById } from "../../readers/json.js";
import { q, str } from "../../readers/values.js";
import { SiteKind, type RawListing, type ShoppingSite } from "../../types.js";
import { blocked, redesigned } from "./outcome.js";

const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "startingTime:DESC",
  [ShoppingSort.PriceLow]: "price:ASC",
  [ShoppingSort.PriceHigh]: "price:DESC",
  [ShoppingSort.EndingSoon]: "endingTime:ASC",
};
/** attributeId of "Stav zboží" (condition). */
const CONDITION_ATTRIBUTE = 48;

type Obj = Record<string, unknown>;

function condition(label: string | undefined): Condition | undefined {
  if (!label) return undefined;
  if (/^nové$/i.test(label)) return Condition.New;
  if (/rozbaleno/i.test(label)) return Condition.OpenBox;
  if (/nefunkční|na díly/i.test(label)) return Condition.ForParts;
  if (/použité|zánovní/i.test(label)) return Condition.Used;
  return undefined;
}

const money = (value: unknown): number | undefined => {
  const n = pick(value, ["amount"]);
  return typeof n === "number" && n > 0 ? n : undefined;
};

function row(item: Obj): RawListing | undefined {
  const id = str(item["itemId"]);
  const slug = str(item["seoUrl"], 500);
  if (!id || !slug) return undefined;
  const auction = item["auction"] === true;
  const price = money(item["price"]);
  const withShipping = money(item["priceWithShipping"]);
  const attrs = Array.isArray(item["attributes"]) ? (item["attributes"] as Obj[]) : [];
  const cond = str(attrs.find((a) => a["attributeId"] === CONDITION_ATTRIBUTE)?.["attributeValue"]);
  const seller = item["seller"] as Obj | undefined;
  const positive = seller?.["positiveFeedbackPercentage"];
  const state = str(item["itemState"]);
  return {
    url: `https://aukro.cz/${slug}-${id}`,
    id,
    title: str(item["itemName"]),
    price,
    currency: str(pick(item, ["price", "currency"])),
    format: auction ? ListingFormat.Auction : ListingFormat.FixedPrice,
    endsAt: auction ? str(item["endingTime"]) : undefined,
    buyNow: auction && item["buyNowActive"] === true ? money(item["buyNowPrice"]) : undefined,
    shipping: item["freeShipping"] === true ? "free" : price !== undefined && withShipping !== undefined && withShipping > price ? Math.round((withShipping - price) * 100) / 100 : undefined,
    condition: condition(cond),
    quantity: typeof item["quantity"] === "number" ? item["quantity"] : undefined,
    status: state === "ENDED" || state === "SOLD" ? ListingStatus.SoldOut : undefined,
    postedAt: str(item["startingTime"]),
    location: str(item["location"]),
    country: "cz",
    seller: str(seller?.["showName"]) ?? str(item["sellerLogin"]),
    sellerFeedbackCount: typeof seller?.["feedbackUniqueUserCount"] === "number" ? seller["feedbackUniqueUserCount"] : undefined,
    sellerFeedbackPercent: typeof positive === "number" ? Math.round(positive * 1_000) / 10 : undefined,
    promoted: item["ppPriorityList"] === true,
    image: str(item["titleImageUrl"], 2_000),
    details: {
      Condition: cond,
      Buyers: typeof item["buyersCountRelative"] === "number" ? item["buyersCountRelative"] : undefined,
      Watchers: typeof item["watchersCount"] === "number" ? item["watchersCount"] : undefined,
      "Personal pickup": item["personalPickup"] === true ? true : undefined,
      "Business seller": seller?.["companyAccount"] === true ? true : undefined,
    },
  };
}

/** The cached searchItemsCommon response in the Angular transfer state. */
function searchResponse(html: string): Obj | undefined {
  const cache = pick(scriptById(html, "ng-state"), ["aukCache"]) as Obj | undefined;
  if (!cache) return undefined;
  const key = Object.keys(cache).find((k) => k.includes("/offers/searchItemsCommon"));
  return key ? (pick(cache, [key, "b"]) as Obj | undefined) : undefined;
}

export const aukro: ShoppingSite = {
  key: "aukro",
  host: "aukro.cz",
  country: "cz",
  currency: "CZK",
  language: "cs",
  kind: SiteKind.Auction,
  listingId: (url) => /^\/[^/]+-(\d{8,})\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    const sort = SORTS[sq.sort];
    const price = `${sq.minPrice !== undefined ? `&priceMin=${Math.floor(sq.minPrice)}` : ""}${sq.maxPrice !== undefined ? `&priceMax=${Math.ceil(sq.maxPrice)}` : ""}`;
    return { url: `https://aukro.cz/vysledky-vyhledavani?text=${q(sq.query)}${price}${sort ? `&sort=${sort}` : ""}${sq.page > 1 ? `&page=${sq.page}` : ""}` };
  },
  read(page) {
    if (looksBlocked(page.content)) return blocked("challenge page");
    const response = searchResponse(page.content);
    if (!response) return redesigned("no searchItemsCommon response in ng-state");
    const content = response["content"];
    if (!Array.isArray(content)) return redesigned("no content in the search response");
    if (content.length === 0) return { kind: "empty" };
    const rows = (content as Obj[]).map(row).filter((r): r is RawListing => r !== undefined);
    const total = pick(response, ["page", "totalElements"]);
    const number = pick(response, ["page", "number"]);
    const pages = pick(response, ["page", "totalPages"]);
    return {
      kind: "results",
      rows,
      total: typeof total === "number" ? total : undefined,
      hasMore: typeof number === "number" && typeof pages === "number" && number + 1 < pages,
    };
  },
};
