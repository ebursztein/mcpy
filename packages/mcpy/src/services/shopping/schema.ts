/**
 * shopping_search and shopping_item. One result is one listing on one site;
 * nothing is merged across sites and nothing is inferred: a field the page
 * does not state is absent. A site answers in one of three distinguishable
 * ways: results (ok), a real empty result page (empty), or not a result page
 * (failed, with a reason).
 */

import { z } from "zod";
import { enumOf, ErrorCodeSchema } from "../../enums.js";
import { maxAgeField, ResultMetaSchema } from "../../schemas.js";
import {
  CountrySchema,
  enumSet,
  LanguageSchema,
  MAX_CURSOR_CHARS,
  MoneySchema,
  RequestPartSchema,
  SiteFailureSchema,
  SiteStatusSchema,
  TextSchema,
  TimestampSchema,
  UrlSchema,
} from "../common.js";
import { MarketplaceSchema } from "./marketplace.js";

const condition = enumOf({ New: "new", OpenBox: "open_box", Refurbished: "refurbished", Used: "used", ForParts: "for_parts" } as const);
export const Condition = condition.values;
export const ConditionSchema = condition.schema;
export type Condition = z.infer<typeof ConditionSchema>;

/** Trading-card grade on Cardmarket's seven-step scale; each site's reader maps its own scale. */
const cardCondition = enumOf({
  Mint: "mint",
  NearMint: "near_mint",
  Excellent: "excellent",
  Good: "good",
  LightPlayed: "light_played",
  Played: "played",
  Poor: "poor",
} as const);
export const CardCondition = cardCondition.values;
export const CardConditionSchema = cardCondition.schema;
export type CardCondition = z.infer<typeof CardConditionSchema>;
/** Best first, so "this grade or better" is an index comparison. */
export const CARD_CONDITION_ORDER: readonly CardCondition[] = cardCondition.schema.options;

/** wanted: a buyer's post, never an ask. */
const listingFormat = enumOf({ FixedPrice: "fixed_price", Auction: "auction", BestOffer: "best_offer", Wanted: "wanted" } as const);
export const ListingFormat = listingFormat.values;
export const ListingFormatSchema = listingFormat.schema;
export type ListingFormat = z.infer<typeof ListingFormatSchema>;

const listingStatus = enumOf({ Available: "available", Reserved: "reserved", SoldOut: "sold_out" } as const);
export const ListingStatus = listingStatus.values;
export const ListingStatusSchema = listingStatus.schema;
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

/** Trading-card game, for card marketplaces and shops that sell several (Cardmarket, CardTrader...). */
const game = enumOf({ Pokemon: "pokemon", Magic: "mtg", YuGiOh: "yugioh", OnePiece: "one_piece", Lorcana: "lorcana" } as const);
export const Game = game.values;
export const GameSchema = game.schema;
export type Game = z.infer<typeof GameSchema>;

const shoppingSort = enumOf({ Newest: "newest", Relevance: "relevance", PriceLow: "price_low", PriceHigh: "price_high", EndingSoon: "ending_soon" } as const);
export const ShoppingSort = shoppingSort.values;
export const ShoppingSortSchema = shoppingSort.schema;
export type ShoppingSort = z.infer<typeof ShoppingSortSchema>;

/**
 * How a row's title must state the query. auto: all_words on sites known to
 * match loosely (any word, or the description), any elsewhere.
 */
const titleMatch = enumOf({ Auto: "auto", Any: "any", AllWords: "all_words", Phrase: "phrase" } as const);
export const TitleMatch = titleMatch.values;
export const TitleMatchSchema = titleMatch.schema;
export type TitleMatch = z.infer<typeof TitleMatchSchema>;

export const MAX_LISTINGS = 60;
export const MAX_SEARCH_DETAILS = 10;

export const ShoppingSearchInputSchema = z
  .object({
    marketplaces: enumSet(MarketplaceSchema, 10).describe("Sites to search; each key is one domain with its own currency, e.g. ebay_de, leboncoin, yahoo_auctions, cardmarket"),
    query: z.string().trim().min(1).max(300).describe("As a seller would write it, in the site's language (リザードン, Glurak)"),
    sort: ShoppingSortSchema.default(ShoppingSort.Newest).describe("A site that cannot sort this way reports sort in ignored"),
    min_price: z.number().nonnegative().optional().describe("In each site's own currency; applied by the site or by mcpy on the rows"),
    max_price: z.number().positive().optional(),
    condition: enumSet(ConditionSchema, 5).optional(),
    game: GameSchema.optional().describe("Trading cards: which game to search on card sites (default: each site's main game); sites without it report unsupported"),
    card_condition: CardConditionSchema.optional().describe("Trading cards: this grade or better"),
    language: enumSet(LanguageSchema, 10).optional().describe("Trading cards: only cards printed in these languages"),
    format: enumSet(ListingFormatSchema, 4).optional(),
    title_match: TitleMatchSchema.default(TitleMatch.Auto).describe(
      "Rows whose title lacks the query are dropped: all_words (every word), phrase (the words together, in order), any (the site's own matching). auto: all_words on sites that match loosely, any elsewhere",
    ),
    max_results: z.number().int().min(1).max(MAX_LISTINGS).default(MAX_LISTINGS).describe("Listings in total for this call"),
    max_products: z.number().int().min(1).max(10).default(3).describe("Card sites and shops: product pages to open for their sellers' listings (one fetch each)"),
    cursor: z.string().min(1).max(MAX_CURSOR_CHARS).optional().describe("next_cursor from the previous call, with the same other inputs. A site that failed or timed out on its first page is not in it: search again without a cursor to retry it"),
    max_age: maxAgeField(900),
  })
  .refine((s) => s.min_price === undefined || s.max_price === undefined || s.min_price <= s.max_price, { message: "min_price is above max_price", path: ["min_price"] });

export const SellerSchema = z.object({
  name: z.string().min(1).max(200),
  feedback_count: z.number().int().nonnegative().optional(),
  feedback_percent: z.number().min(0).max(100).optional(),
});

export const AuctionSchema = z.object({
  bids: z.number().int().nonnegative().optional(),
  ends_at: TimestampSchema.optional(),
  buy_now: MoneySchema.optional().describe("Buy-now price; price is the current bid, which is not an ask"),
});

export const ProductRefSchema = z.object({
  id: z.string().min(1).max(200),
  url: UrlSchema,
  title: z.string().min(1).max(500).optional(),
});

export const SearchDetailsSchema = z
  .record(z.string().min(1).max(50), z.string().max(200))
  .refine((d) => Object.keys(d).length <= MAX_SEARCH_DETAILS, `at most ${MAX_SEARCH_DETAILS} details`);

export const ListingSchema = z.object({
  marketplace: MarketplaceSchema,
  id: z.string().min(1).max(200).describe("The site's own listing id"),
  url: UrlSchema.describe("Listing URL on the site's own domain, no tracking; for an offer on a product page, that page"),
  title: z.string().min(1).max(500).describe("As the seller wrote it, not translated"),
  title_original: z.string().max(500).optional(),
  description: TextSchema.optional(),
  price: MoneySchema.optional().describe("As stated; absent when the page shows none"),
  format: ListingFormatSchema.optional(),
  auction: AuctionSchema.optional(),
  shipping: MoneySchema.optional().describe("amount 0 is free shipping"),
  condition: ConditionSchema.optional(),
  card_condition: CardConditionSchema.optional(),
  language: LanguageSchema.optional().describe("Trading cards: the card's printed language"),
  quantity: z.number().int().positive().optional(),
  product: ProductRefSchema.optional().describe("The product page this offer is listed under"),
  status: ListingStatusSchema.optional(),
  posted_at: TimestampSchema.optional(),
  posted_text: z.string().max(50).optional().describe("The site's relative age when no time is stated; never guessed"),
  location: z.string().max(200).optional(),
  country: CountrySchema.optional().describe("Where the item is"),
  seller: SellerSchema.optional(),
  promoted: z.boolean().optional(),
  price_converted: z
    .boolean()
    .optional()
    .describe("The store showed a listing from another country in its own currency or with its own taxes; the seller's own price may differ"),
  image: UrlSchema.optional(),
  details: SearchDetailsSchema.optional(),
});
export type Listing = z.infer<typeof ListingSchema>;

export const MarketplaceReportSchema = z.object({
  marketplace: MarketplaceSchema,
  status: SiteStatusSchema,
  results: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().optional(),
  unmatched: z.number().int().positive().optional().describe("Rows this page returned whose title did not match the query (title_match); dropped"),
  cost_usd: z.number().nonnegative().optional().describe("Estimated USD this store cost this call"),
  search_url: UrlSchema,
  observed_at: TimestampSchema,
  ignored: z.array(RequestPartSchema).optional().describe("Requested but not applied; results are still returned"),
  failure: SiteFailureSchema.optional(),
  error: ErrorCodeSchema.optional(),
  http_status: z.number().int().optional(),
  final_url: UrlSchema.optional(),
});
export type MarketplaceReport = z.infer<typeof MarketplaceReportSchema>;

export const ShoppingSearchResultSchema = z.object({
  query: z.string(),
  results: z.array(ListingSchema),
  marketplaces: z.array(MarketplaceReportSchema),
  next_cursor: z.string().max(MAX_CURSOR_CHARS).optional(),
  meta: ResultMetaSchema,
});

export const ShoppingItemInputSchema = z.object({
  url: UrlSchema.describe("A listing url from shopping_search"),
  max_age: maxAgeField(900),
});

export const ShoppingItemResultSchema = ListingSchema.omit({ details: true }).extend({
  description: z.string().max(10_000).optional(),
  images: z.array(UrlSchema).max(24).optional(),
  details: z.record(z.string().min(1).max(100), z.string().max(500)).optional(),
  observed_at: TimestampSchema,
  meta: ResultMetaSchema,
});

export type ShoppingSearchInput = z.input<typeof ShoppingSearchInputSchema>;
export type ShoppingSearchQuery = z.infer<typeof ShoppingSearchInputSchema>;
export type ShoppingSearchResult = z.infer<typeof ShoppingSearchResultSchema>;
export type ShoppingItemInput = z.input<typeof ShoppingItemInputSchema>;
export type ShoppingItemResult = z.infer<typeof ShoppingItemResultSchema>;
