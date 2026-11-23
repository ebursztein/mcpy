/**
 * tutti.ch and anibis.ch: one SMG platform. Probed 2026-11-22 through
 * tools.ly.tl: the search page is /q/suche/<token>, where the token is "A"
 * plus base64url msgpack [query, category, [strings, ?, ?,
 * locations]] (decoded from the site's own category and city links). Rows are in __NEXT_DATA__
 * at the SearchListingsByConstraints query in dehydratedState (30 a page).
 * sorting=newest|cheapest|expensive|relevant and page=N are URL parameters
 * the site applies (checked: redux state echoes them). The price constraint
 * lives in the token and its layout could not be found from the outside
 * (twelve layouts tried: all ignored or rejected), so mcpy applies the price.
 * An unreadable token falls back to every listing on the site: a page whose
 * query is not ours is read as redesigned, never as results. The search
 * matches any word (anibis "black lotus" returns cars), so rows must contain
 * every word in title or body.
 */

import { ShoppingSort } from "../../../services/shopping/schema.js";
import type { Marketplace } from "../../../services/shopping/marketplace.js";
import { looksBlocked } from "../../readers/html.js";
import { nextData, pick } from "../../readers/json.js";
import { str } from "../../readers/values.js";
import type { RawListing, ShoppingSite } from "../../types.js";
import { relevant, Relevance } from "./shared.js";

const PAGE_SIZE = 30;
const SORTS: Partial<Record<string, string>> = {
  [ShoppingSort.Newest]: "newest",
  [ShoppingSort.PriceLow]: "cheapest",
  [ShoppingSort.PriceHigh]: "expensive",
  [ShoppingSort.Relevance]: "relevant",
};

type Obj = Record<string, unknown>;

/** msgpack of [query, nil, [nil, nil, nil, nil]]: a search for the words in every category, no constraints. */
function msgpackQuery(query: string): Uint8Array {
  const text = new TextEncoder().encode(query.slice(0, 200));
  const head = text.length < 32 ? [0xa0 | text.length] : [0xd9, text.length];
  return Uint8Array.from([0x93, ...head, ...text, 0xc0, 0x94, 0xc0, 0xc0, 0xc0, 0xc0]);
}

export function searchToken(query: string): string {
  let bin = "";
  for (const b of msgpackQuery(query)) bin += String.fromCharCode(b);
  return `A${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

function row(node: Obj, origin: string): RawListing | undefined {
  const id = str(node["listingID"]);
  if (!id) return undefined;
  const place = (node["postcodeInformation"] ?? {}) as Obj;
  const canton = str(pick(place, ["canton", "shortName"]));
  const city = str(place["locationName"]);
  const price = str(node["formattedPrice"]);
  return {
    url: `${origin}/de/vi/${id}`,
    id,
    title: str(pick(node, ["localization", "title"])),
    description: str(pick(node, ["localization", "body"]), 1_200),
    price,
    currency: "CHF",
    postedAt: str(node["timestamp"]),
    location: city && canton ? `${city} ${canton}` : city,
    country: "ch",
    seller: str(pick(node, ["sellerInfo", "alias"])),
    promoted: node["highlighted"] === true,
    image: str(pick(node, ["thumbnail", "normalRendition", "src"]), 2_000),
    details: { Price: price && !/\d/.test(price) ? price : undefined, Category: str(pick(node, ["primaryCategory", "categoryID"])), Language: str(node["language"]) },
  };
}

function platform(key: Marketplace, host: string): ShoppingSite {
  const origin = `https://${host}`;
  return {
    key,
    host,
    country: "ch",
    currency: "CHF",
    language: "de",
    kind: "classifieds",
    listingId: (url) => /^\/(?:de|fr|it)\/vi\/(?:[^?#]*\/)?(\d{5,})\/?$/.exec(url.pathname)?.[1],
    search(sq) {
      const sorting = SORTS[sq.sort];
      const params = [sorting ? `sorting=${sorting}` : "", sq.page > 1 ? `page=${sq.page}` : ""].filter(Boolean);
      return {
        url: `${origin}/de/q/suche/${searchToken(sq.query)}${params.length ? `?${params.join("&")}` : ""}`,
        applies: { sort: sorting !== undefined },
      };
    },
    read(page, sq) {
      if (looksBlocked(page.content)) return { kind: "failed", failure: "blocked", detail: "challenge page" };
      const props = pick(nextData(page.content), ["props", "pageProps"]) as Obj | undefined;
      const queries = pick(props, ["dehydratedState", "queries"]);
      const search = Array.isArray(queries) ? (queries as Obj[]).find((x) => pick(x, ["queryKey", 0]) === "SearchListingsByConstraints") : undefined;
      const listings = pick(search, ["state", "data", "listings"]) as Obj | undefined;
      if (!listings || !Array.isArray(listings["edges"])) return { kind: "failed", failure: "redesigned", detail: "no SearchListingsByConstraints listings in __NEXT_DATA__" };
      const echoed = pick(props, ["initialReduxState", "searchResultPage", "query"]);
      if (typeof echoed === "string" && echoed.trim() !== sq.query.trim()) return { kind: "failed", failure: "redesigned", detail: "the site did not read the search token" };
      const nodes = (listings["edges"] as Obj[]).map((e) => e["node"]).filter((n): n is Obj => !!n && typeof n === "object");
      const hits = relevant(sq.query, nodes, (n) => [str(pick(n, ["localization", "title"])), str(pick(n, ["localization", "body"]), 5_000)], Relevance.Row);
      if (hits.length === 0) return { kind: "empty" };
      const rows = hits.map((n) => row(n, origin)).filter((r): r is RawListing => r !== undefined);
      const total = hits.length === nodes.length && typeof listings["totalCount"] === "number" ? listings["totalCount"] : undefined;
      return { kind: "results", rows, total, hasMore: nodes.length >= PAGE_SIZE };
    },
  };
}

export const tutti = platform("tutti", "www.tutti.ch");
export const anibis = platform("anibis", "www.anibis.ch");
