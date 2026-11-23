/**
 * CardTrader. Probed 2026-11-22 (plain fetch): /en/search?q=...&game=pokemon
 * server-renders the matching blueprints (one card printing each) into the
 * BlueprintSearch React props, with the number of offers per blueprint. Without
 * `game` the search covers Magic only and there is no cross-game search; game=
 * pokemon, magic, yu-gi-oh, one-piece, lorcana each served their own search
 * (checked). Pokémon is the default. Each blueprint page
 * loads its offers from /en/cards/{id}.json (the page's own paginationUrl),
 * which answers a plain fetch: seller, country, condition, language, price.
 * Sorting and price bounds apply to blueprints, not offers: left to mcpy.
 */

import { SiteFailure } from "../../services/common.js";
import { Game, ListingFormat } from "../../services/shopping/schema.js";
import { decodeEntities, looksBlocked } from "../readers/html.js";
import { bodyJson, parseJson, pick } from "../readers/json.js";
import { q, str } from "../readers/values.js";
import { SiteKind, type ProductLink, type RawListing, type ShoppingSite } from "../types.js";
import { languageCode, usGrade } from "./grades.js";

/** CardTrader's game slug per game. */
const GAMES: Readonly<Record<Game, string>> = { [Game.Pokemon]: "pokemon", [Game.Magic]: "magic", [Game.YuGiOh]: "yu-gi-oh", [Game.OnePiece]: "one-piece", [Game.Lorcana]: "lorcana" };
const BASE = "https://www.cardtrader.com/en";

type Obj = Record<string, unknown>;

const blueprintUrl = (slug: string): string => `${BASE}/cards/${slug}`;

/** The props of the BlueprintSearch React component, or undefined when the page has none. */
function searchProps(html: string): Obj | undefined {
  const props = /data-react-class="BlueprintSearch"[^>]*?data-react-props="([^"]*)"/.exec(html)?.[1];
  const value = props ? parseJson(decodeEntities(props)) : undefined;
  return value && typeof value === "object" ? (value as Obj) : undefined;
}

function offer(p: Obj, link: ProductLink, extra: Obj): RawListing | undefined {
  const id = typeof p["id"] === "number" ? String(p["id"]) : undefined;
  if (!id) return undefined;
  const props = (p["properties_hash"] ?? {}) as Obj;
  const langKey = Object.keys(props).find((k) => k.endsWith("_language"));
  const grade = str(props["condition"]);
  const user = (p["user"] ?? {}) as Obj;
  const feedback = (extra[String(user["id"])] ?? {}) as Obj;
  const cents = pick(p, ["price", "cents"]);
  return {
    url: link.url,
    id,
    title: link.title ?? str(p["name_en"]),
    description: str(p["description"]),
    price: typeof cents === "number" ? cents / 100 : undefined,
    currency: str(pick(p, ["price", "currency"])),
    format: ListingFormat.FixedPrice,
    cardCondition: usGrade(grade),
    language: languageCode(langKey ? str(props[langKey]) : undefined),
    quantity: p["quantity"] as number,
    seller: str(user["username"]),
    sellerFeedbackCount: feedback["feedbacks_count"] as number,
    sellerFeedbackPercent: feedback["avg_rating_percentage"] as number,
    country: str(user["country_code"]),
    details: {
      Condition: grade,
      Expansion: str(pick(p, ["expansion", "name_en"])),
      Graded: p["graded"] === true ? true : undefined,
      Foil: props["mtg_foil"] === true || props["pokemon_reverse"] === true ? true : undefined,
      "First edition": props["first_edition"] === true ? true : undefined,
      "On vacation": p["on_vacation"] === true ? true : undefined,
    },
  };
}

export const cardtrader: ShoppingSite = {
  key: "cardtrader",
  host: "www.cardtrader.com",
  country: "it",
  currency: "EUR",
  language: "en",
  kind: SiteKind.Marketplace,
  games: [Game.Pokemon, Game.Magic, Game.YuGiOh, Game.OnePiece, Game.Lorcana],
  listingId: (url) => /^\/[a-z]{2}(?:-[A-Z]{2})?\/cards\/(\d+)/.exec(url.pathname)?.[1],
  search(sq) {
    return { url: `${BASE}/search?q=${q(sq.query)}&game=${GAMES[sq.game ?? Game.Pokemon]}${sq.page > 1 ? `&page=${sq.page}` : ""}` };
  },
  read(page) {
    if (looksBlocked(page.content)) return { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" };
    const props = searchProps(page.content);
    if (!props) return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no BlueprintSearch props" };
    const blueprints = Array.isArray(props["prefilledBlueprints"]) ? (props["prefilledBlueprints"] as Obj[]) : [];
    const counts = (props["prefilledProductsCountByBlueprint"] ?? {}) as Record<string, number>;
    const products: ProductLink[] = [];
    for (const b of blueprints) {
      const id = typeof b["id"] === "number" ? String(b["id"]) : undefined;
      const slug = str(b["slug"]);
      if (!id || !slug || !(counts[id]! > 0)) continue;
      const name = str(b["name"]);
      const set = str(pick(b, ["expansion", "name"]));
      const version = str(b["version"]);
      products.push({ id, url: blueprintUrl(slug), title: [name, version && `(${version})`, set && `- ${set}`].filter(Boolean).join(" ") || undefined });
    }
    if (!products.length) return { kind: "empty" };
    return { kind: "results", rows: [], products, hasMore: blueprints.length >= Number(props["perPage"] ?? 12) };
  },
  product: {
    request: (link) => ({ url: `${BASE}/cards/${link.id}.json` }),
    read(page, link) {
      const json = bodyJson(page.content) as Obj | undefined;
      if (!json || typeof json !== "object") {
        return looksBlocked(page.content)
          ? { kind: "failed", failure: SiteFailure.Blocked, detail: "challenge page" }
          : { kind: "failed", failure: SiteFailure.Redesigned, detail: "offers are not JSON" };
      }
      if (!Array.isArray(json["products"])) return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no products in the offers JSON" };
      const extra = (json["users_extra_data"] ?? {}) as Obj;
      const rows = (json["products"] as Obj[]).map((p) => offer(p, link, extra)).filter((r): r is RawListing => r !== undefined);
      return rows.length ? { kind: "results", rows, total: typeof json["products_count"] === "number" ? json["products_count"] : undefined } : { kind: "empty" };
    },
  },
};
