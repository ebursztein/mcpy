/**
 * Serpent API response shapes (apiserpent.com/docs, checked live
 * 2026-11-23). Every field a row may lack arrives as null, so rows are
 * nullish throughout; the envelope also carries the error fields, because an
 * error answer is the same JSON object with `success: false`.
 */

import { z } from "zod";

const text = z.string().nullish();

const OrganicRow = z.object({
  url: text,
  title: text,
  snippet: text,
  publishedTime: text,
  publisher: text,
});

const NewsRow = z.object({
  url: text,
  title: text,
  snippet: text,
  source: text,
  publishedTime: text,
  image: text,
});

const ImageRow = z.object({
  title: text,
  original: text,
  thumbnail: text,
  pageUrl: text,
  source: text,
});

/** Standard web search (`/api/search/quick`), news (`/api/news`) and images (`/api/images`) in format=full. */
export const SerpentResponseSchema = z.object({
  success: z.boolean(),
  /** Error answers: a stable snake_case token and a sentence. */
  code: z.string().optional(),
  message: z.string().optional(),
  results: z
    .object({
      organic: z.array(OrganicRow).nullish(),
      articles: z.array(NewsRow).nullish(),
      images: z.array(ImageRow).nullish(),
    })
    .nullish(),
});

export type SerpentResponse = z.infer<typeof SerpentResponseSchema>;

const EbayListing = z.object({
  item_id: z.union([z.string(), z.number()]).nullish(),
  title: text,
  url: text,
  price: z.object({ value: z.number(), currency: z.string() }).nullish(),
  condition: text,
  shipping: text,
  /** A name, or an object naming the seller; null on search rows seen live. */
  seller: z.union([z.string(), z.object({ username: text, name: text }).passthrough()]).nullish(),
  images: z.array(z.string()).nullish(),
});

/** eBay search (`/api/ebay/search`), checked live 2026-11-23. Errors share the envelope. */
export const EbaySearchResponseSchema = z.object({
  success: z.boolean(),
  code: z.string().optional(),
  message: z.string().optional(),
  marketplace: z.string().nullish(),
  results: z.array(EbayListing).nullish(),
  /** eBay's stated count, when it states one exactly. */
  total_results: z.number().nullish(),
  next_page_url: text,
});

export type EbaySearchResponse = z.infer<typeof EbaySearchResponseSchema>;
