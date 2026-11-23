/**
 * MercadoLibre search state -> rows. The search page assigns its state to
 * `_n.ctx.r`; rows are appProps.pageProps.initialState.results[].polycard,
 * each one item (metadata.id, e.g. MLB6866391086) described by typed
 * components (title, price, shipping_v2, seller, review_compacted, cbt).
 * Catalog cards (/p/MLB…) show their winning offer, whose item id is
 * metadata.id, so every row is a listing and its URL is the item's own page.
 */

import { ListingFormat } from "../../services/shopping/schema.js";
import { assigned, pick } from "../readers/json.js";
import { str } from "../readers/values.js";
import type { RawListing } from "../types.js";

type Obj = Record<string, unknown>;

export interface MeliState {
  results: Obj[];
  total?: number;
  hasMore: boolean;
  pictureTemplate?: string;
}

export function meliState(html: string): MeliState | undefined {
  const state = pick(assigned(html, "_n.ctx.r"), ["appProps", "pageProps", "initialState"]) as Obj | undefined;
  if (!state || !Array.isArray(state["results"])) return undefined;
  const total = pick(state, ["melidata_track", "event_data", "total"]);
  return {
    results: state["results"] as Obj[],
    total: typeof total === "number" ? total : undefined,
    hasMore: pick(state, ["pagination", "next_page", "show"]) === true,
    pictureTemplate: str(pick(state, ["polycard_context", "picture_template"]), 300),
  };
}

const component = (card: Obj, type: string): Obj | undefined =>
  (Array.isArray(card["components"]) ? (card["components"] as Obj[]) : []).find((c) => c["type"] === type)?.[type] as Obj | undefined;

/** The label text of a templated component ({"text":"{label}","values":[{"key":"label","label":{"text":"…"}}]}). */
function label(value: Obj | undefined, key = "label"): string | undefined {
  const values = Array.isArray(value?.["values"]) ? (value!["values"] as Obj[]) : [];
  return str(pick(values.find((v) => v["key"] === key), ["label", "text"]));
}

function freeShipping(card: Obj): boolean {
  const blocks = component(card, "shipping_v2");
  return JSON.stringify(blocks ?? "").includes('"key":"free_shipping');
}

function image(card: Obj, template: string | undefined): string | undefined {
  const id = str(pick(card, ["pictures", "pictures", 0, "id"]));
  if (!id) return undefined;
  const square = str(pick(card, ["pictures", "square"])) ?? "Q";
  return (template ?? "https://http2.mlstatic.com/D_{square}_NP{2x}_{id}-{size}{sanitized_title}.webp")
    .replace("{square}", square)
    .replace("{2x}", "")
    .replace("{id}", id)
    .replace("{size}", "E")
    .replace("{sanitized_title}", "");
}

/** One polycard -> a row; `itemHost` serves item pages by id (produto.mercadolivre.com.br). */
export function meliRow(result: Obj, itemHost: string, template: string | undefined): RawListing | undefined {
  const card = result["polycard"] as Obj | undefined;
  if (!card || (result["state"] !== undefined && result["state"] !== "VISIBLE")) return undefined;
  const meta = (card["metadata"] ?? {}) as Obj;
  const m = /^(ML[A-Z])(\d{6,13})$/.exec(str(meta["id"]) ?? "");
  if (!m) return undefined;
  const price = pick(component(card, "price"), ["current_price"]) as Obj | undefined;
  const previous = pick(component(card, "price"), ["previous_price", "value"]);
  const promotions = component(card, "promotions") as unknown;
  return {
    url: `https://${itemHost}/${m[1]}-${m[2]}-_JM`,
    id: `${m[1]}${m[2]}`,
    title: str(pick(component(card, "title"), ["text"])),
    price: price?.["value"] as number | undefined,
    currency: str(price?.["currency"]),
    format: ListingFormat.FixedPrice,
    shipping: freeShipping(card) ? "free" : undefined,
    seller: label(component(card, "seller")),
    location: label(component(card, "cbt"), "country_text"),
    promoted: card["ads_promotions"] !== undefined || meta["is_pad"] === "true",
    image: image(card, template),
    details: {
      "Old price": typeof previous === "number" ? previous : undefined,
      Rating: label(component(card, "review_compacted")),
      Highlight: str(str(pick(card, ["float_highlight_generic", "highlight", "text"]))?.replace(/\{[^}]+\}/g, "")),
      Promotion: Array.isArray(promotions) ? str((promotions as Obj[])[0]?.["text"]) : undefined,
      "Catalog product": str(meta["product_id"]),
      International: component(card, "cbt") ? true : undefined,
    },
  };
}
