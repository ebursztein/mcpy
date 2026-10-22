import { z } from "zod";

/** Web Unlocker `format: "json"` envelope. */
export const UnlockerEnvelopeSchema = z.object({
  status_code: z.number().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});

/**
 * Parsed Google SERP (`brd_json=1`), as documented in "Parsed JSON results".
 * Result sections stay `unknown[]` here: each item is validated on its own
 * (see serp-map.ts) so one odd item cannot discard a whole page.
 */
export const SerpSchema = z.object({
  organic: z.array(z.unknown()).optional(),
  news: z.array(z.unknown()).optional(),
  top_stories: z.object({ items: z.array(z.unknown()).optional() }).partial().optional(),
  images: z.array(z.unknown()).optional(),
  videos: z.array(z.unknown()).optional(),
  short_videos: z.array(z.unknown()).optional(),
  shopping: z.array(z.unknown()).optional(),
  jobs: z.object({ items: z.array(z.unknown()).optional() }).partial().optional(),
  snack_pack: z.array(z.unknown()).optional(),
  /** Present on every parsed SERP, including ones with zero results. */
  general: z.unknown().optional(),
  /** Some zone configs wrap the SERP in the unlocker envelope. */
  body: z.string().optional(),
});
export type Serp = z.infer<typeof SerpSchema>;

const text = z.string().optional();
/** Counts and ratings arrive as numbers or strings ("4.5", "1,234"). */
const numeric = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : Number(v.replace(/[^\d.]/g, ""))))
  .pipe(z.number().finite())
  .optional()
  .catch(undefined);
const priceText = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .optional()
  .catch(undefined);

export const OrganicItem = z.object({ link: z.string(), title: text, description: text, last_modified_date: text, image: text });
export const NewsItem = z.object({ link: z.string(), title: text, description: text, source: text, date: text, image: text });
export const ImageItem = z.object({ link: z.string(), title: text, source: text, image: text, original_image: text });
export const VideoItem = z.object({ link: z.string(), title: text, source: text, date: text, duration: text, image: text });
export const ShoppingItem = z.object({
  link: z.string(),
  title: text,
  description: text,
  price: priceText,
  shop: text,
  rating: numeric,
  reviews_cnt: numeric,
  image: text,
});
export const JobItem = z.object({ link: z.string(), title: text, company: text, location: text, source: text, description: text });
export const PlaceItem = z.object({
  name: z.string(),
  link: text,
  maps_link: text,
  address: text,
  phone: text,
  rating: numeric,
  reviews_cnt: numeric,
  type: text,
  price: priceText,
});
