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

const toPage = (p: Partial<FoundPage> & { url: string }): FoundPage => ({ ...p, title: p.title || p.url, snippet: p.snippet ?? "" });

const MAPPERS: Record<SearchType, (serp: Serp) => FoundPage[]> = {
  [SearchType.Web]: (s) =>
    items(s.organic, OrganicItem).map((o) => toPage({ url: o.link, title: o.title, snippet: o.description, date: o.last_modified_date, image: o.image })),
  [SearchType.News]: (s) =>
    [...items(s.news, NewsItem), ...items(s.top_stories?.items, NewsItem)].map((n) =>
      toPage({ url: n.link, title: n.title, snippet: n.description, publisher: n.source, date: n.date, image: n.image }),
    ),
  [SearchType.Images]: (s) =>
    items(s.images, ImageItem).map((i) => toPage({ url: i.link, title: i.title, publisher: i.source, image: i.original_image ?? i.image })),
  [SearchType.Videos]: (s) =>
    [...items(s.videos, VideoItem), ...items(s.short_videos, VideoItem)].map((v) =>
      toPage({ url: v.link, title: v.title, publisher: v.source, date: v.date, duration: v.duration, image: v.image }),
    ),
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
      const url = p.link ?? p.maps_link;
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
