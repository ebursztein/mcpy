/** The cache spaces the engine owns (inventory and versions: cache/spaces.ts). */
import { z } from "zod";
import { cacheSpace, CacheName, requiredFields } from "../cache/spaces.js";
import { ContentKindSchema, PageFormatSchema } from "../enums.js";
import type { FetchedPage } from "../providers/types.js";
import type { FoundListing, ListingPage } from "../providers/listing-types.js";
import type { MergedPage } from "./merge.js";
import type { MergedPaper } from "./papers.js";

/** A page as stored. Loose, so a field added to FetchedPage later is never dropped on a read. */
export const FetchedPageSchema: z.ZodType<FetchedPage> = z.looseObject({
  url: z.string(),
  finalUrl: z.string(),
  status: z.number().int(),
  contentType: z.string(),
  kind: ContentKindSchema,
  title: z.string().optional(),
  content: z.string(),
  format: PageFormatSchema,
});

export const PageSpace = cacheSpace(CacheName.Page, FetchedPageSchema);
export const PinSpace = cacheSpace(CacheName.Pin, FetchedPageSchema);

const MergedPageSchema = requiredFields<MergedPage>({ url: z.string(), title: z.string(), snippet: z.string(), sources: z.number() });
const MergedPaperSchema = requiredFields<MergedPaper>({ title: z.string(), authors: z.array(z.string()), url: z.string(), sources: z.number() });
const ListingSchema = requiredFields<FoundListing>({ url: z.string(), images: z.array(z.string()) });

export const SearchSpace = cacheSpace(CacheName.Search, z.array(MergedPageSchema));
export const PapersSpace = cacheSpace(CacheName.Papers, z.array(MergedPaperSchema));
export const ListingsSpace = cacheSpace(CacheName.Listings, requiredFields<ListingPage>({ rows: z.array(ListingSchema), hasMore: z.boolean(), total: z.number().optional() }));
/** The provider id that last served a site. */
export const SiteRouteSpace = cacheSpace(CacheName.SiteRoute, z.string().min(1));
/** Present while a site's paid sources are paused. */
export const PaidFailureSpace = cacheSpace(CacheName.PaidFailure, z.literal(true));
