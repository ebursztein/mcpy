/** Parsed-SERP sections -> FoundPage, one mapper per search type. */

import type { z } from "zod";
import { SearchType } from "../../enums.js";
import type { FoundPage } from "../types.js";
import { ImageItem, JobItem, NewsItem, OrganicItem, PlaceItem, ShoppingItem, VideoItem, type Serp } from "./schemas.js";

/** Validate items one by one, dropping the ones that do not fit. */
function items<S extends z.ZodType>(raw: unknown[] | undefined, schema: S): z.infer<S>[] {
  return (raw ?? []).flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Google's expand-button text, captured at the end of some descriptions. */
const READ_MORE = /\s*(\.{3}|…)?\s*Read more\s*$/i;

/**
 * Normalize a mapped item. Images must be links: Bright Data inlines many
 * thumbnails as base64 data URIs (tens of KB each), which would flood an
 * LLM's context, so those are dropped.
 */
const toPage = (p: Partial<FoundPage> & { url: string }): FoundPage => ({
  ...p,
  title: p.title || p.url,
  snippet: (p.snippet ?? "").replace(READ_MORE, ""),
  image: p.image && /^https?:\/\//i.test(p.image) ? p.image : undefined,
});

/** "www.youtube.com › watch" -> "www.youtube.com" (Google breadcrumbs). */
const site = (source: string | undefined) => source?.split(" › ")[0]?.trim() || undefined;

/**
 * Image results: `title` is the site name and `source` is the page title
 * with the site name appended ("Golden Gate Bridge - WikipediaWikipedia").
 */
function imageTitle(source: string | undefined, siteName: string | undefined): string | undefined {
  if (source && siteName && source.endsWith(siteName) && source.length > siteName.length) return source.slice(0, -siteName.length).trim();
  return source ?? siteName;
}

/** Google Maps link for a place id when the SERP gives no link. */
const mapsLink = (cid: string | undefined) => (cid ? `https://maps.google.com/?cid=${encodeURIComponent(cid)}` : undefined);

const MAPPERS: Record<SearchType, (serp: Serp) => FoundPage[]> = {
  [SearchType.Web]: (s) =>
    items(s.organic, OrganicItem).map((o) => toPage({ url: o.link, title: o.title, snippet: o.description, date: o.last_modified_date, image: o.image })),
  [SearchType.News]: (s) =>
    [...items(s.news, NewsItem), ...items(s.top_stories?.items, NewsItem)].map((n) =>
      toPage({ url: n.link, title: n.title, snippet: n.description, publisher: n.source, date: n.date, image: n.image }),
    ),
  // `link` is a Google redirect to the page; the image itself is original_image.
  [SearchType.Images]: (s) =>
    items(s.images, ImageItem).map((i) =>
      toPage({ url: i.link, title: imageTitle(i.source, i.title), publisher: i.title, image: i.original_image ?? i.image }),
    ),
  // Video searches put direct links in `organic` (seen live); `videos` carries
  // Google redirect links to the same videos, so it is only a fallback.
  [SearchType.Videos]: (s) => {
    const organic = items(s.organic, VideoItem);
    const list = organic.length ? organic : [...items(s.videos, VideoItem), ...items(s.short_videos, VideoItem)];
    return list.map((v) =>
      toPage({ url: v.link, title: v.title, snippet: v.description, publisher: site(v.source), date: v.date, duration: v.duration, image: v.image }),
    );
  },
  [SearchType.Shopping]: (s) =>
    items(s.shopping, ShoppingItem).map((p) =>
      toPage({ url: p.link, title: p.title, snippet: p.description, publisher: p.shop, price: p.price, rating: p.rating, reviews: p.reviews_cnt, image: p.image }),
    ),
  [SearchType.Jobs]: (s) =>
    items(s.jobs?.items, JobItem).map((j) =>
      toPage({ url: j.link, title: j.title, snippet: j.description, company: j.company, location: j.location, publisher: j.source }),
    ),
  [SearchType.Places]: (s) =>
    items(s.snack_pack, PlaceItem).flatMap((p) => {
      const url = p.link ?? p.maps_link ?? mapsLink(p.cid);
      if (!url) return [];
      return [toPage({ url, title: p.name, snippet: p.type ?? "", address: p.address, phone: p.phone, rating: p.rating, reviews: p.reviews_cnt, price: p.price })];
    }),
};

export function mapSerp(type: SearchType, serp: Serp): FoundPage[] {
  return MAPPERS[type](serp);
}

/** True when the SERP has no section for this type at all (an error envelope, not "no results"). */
export function isEmptyEnvelope(serp: Serp): boolean {
  const sections = [serp.organic, serp.news, serp.top_stories, serp.images, serp.videos, serp.short_videos, serp.shopping, serp.jobs, serp.snack_pack];
  return serp.general === undefined && sections.every((s) => s === undefined);
}
