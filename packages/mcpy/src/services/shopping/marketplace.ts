/**
 * Every shopping site, one key per domain (ebay_de and ebay_fr are two sites
 * with their own currency). sites/registry.ts must define a reader for each
 * key; a test fails otherwise.
 */

import { z } from "zod";

export const MARKETPLACES = [
  // eBay
  "ebay_us",
  "ebay_uk",
  "ebay_de",
  "ebay_fr",
  "ebay_it",
  "ebay_es",
  // Trading-card marketplaces and shops
  "tcgplayer",
  "cardmarket",
  "cardtrader",
  "cardkingdom",
  "starcitygames",
  "coolstuffinc",
  "hareruya",
  "yuyutei",
  "cardrush",
  "dorasuta",
  "magi",
  "surugaya",
  // Europe
  "leboncoin",
  "subito",
  "marktplaats",
  "2dehands",
  "willhaben",
  "ricardo",
  "tutti",
  "anibis",
  "catawiki",
  "olx_pl",
  "olx_pt",
  "olx_ro",
  "olx_bg",
  "olx_ua",
  "allegro_lokalnie",
  "blocket",
  "finn",
  "dba",
  "tori",
  "aukro",
  "jofogas",
  "njuskalo",
  "bolha",
  "locanto_de",
  "locanto_fr",
  "locanto_it",
  "locanto_es",
  "locanto_gb",
  "kleinanzeigen",
  "bazos_cz",
  "bazos_sk",
  "sbazar",
  "todocoleccion",
  "skelbiu",
  "gumtree",
  "kupujemprodajem",
  "vinted_fr",
  "wallapop",
  "milanuncios",
  "shpock",
  "adverts_ie",
  "sahibinden",
  "dubizzle_ae",
  // Japan and Korea
  "yahoo_auctions",
  "paypay_flea",
  "mercari_jp",
  "rakuma",
  "joongna",
  "bunjang",
  "daangn",
  // Latin America
  "olx_br",
  "mercadolivre_br",
  "mercadolibre_ar",
  "mercadolibre_mx",
  "mercadolibre_cl",
  "mercadolibre_co",
] as const;

export type Marketplace = (typeof MARKETPLACES)[number];
export const MarketplaceSchema = z.enum(MARKETPLACES);
export const Marketplace = Object.fromEntries(MARKETPLACES.map((k) => [k, k])) as { readonly [K in Marketplace]: K };
