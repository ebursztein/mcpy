/** Public contract for paper search. No provider appears anywhere. */

import { z } from "zod";
import { PaperCollectionSchema, PaperSort, PaperSortSchema, SearchMode, SearchModeSchema } from "./enums.js";
import { ResultMetaSchema } from "./schemas.js";

export const MAX_PAPER_RESULTS = 50;
export const MAX_PAPER_PAGE = 10;
const year = z.number().int().min(1800).max(2100);

export const PaperSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500).describe("Topic, title or keywords"),
    max_results: z.number().int().min(1).max(MAX_PAPER_RESULTS).default(10),
    page: z.number().int().min(1).max(MAX_PAPER_PAGE).default(1).describe("Page of results, 1 is the first"),
    year_from: year.optional().describe("Only papers published in or after this year"),
    year_to: year.optional().describe("Only papers published in or before this year"),
    open_access: z.boolean().default(false).describe("Only papers with a free full text"),
    sort: PaperSortSchema.default(PaperSort.Relevance).describe("relevance, citations (most cited first) or newest"),
    collection: PaperCollectionSchema.optional().describe("preprints (not yet peer-reviewed) or biomedical (life sciences and medicine); default: everything"),
    mode: SearchModeSchema.default(SearchMode.Fast).describe("fast: first index that answers; thorough: combine all indexes (slower)"),
    fresh: z.boolean().default(false).describe("Ignore the cache and search again"),
  })
  .refine((p) => p.year_from === undefined || p.year_to === undefined || p.year_from <= p.year_to, {
    message: "year_from must not be after year_to",
    path: ["year_from"],
  });

/** Most authors listed per paper; `authors_total` gives the full count. */
export const MAX_AUTHORS = 10;

export const PaperSchema = z.object({
  title: z.string(),
  authors: z.array(z.string()).max(MAX_AUTHORS),
  authors_total: z.number().int().nonnegative(),
  year: z.number().int().optional(),
  published: z.string().optional().describe("Publication date (YYYY-MM-DD) when known"),
  venue: z.string().optional().describe("Journal, conference or archive"),
  abstract: z.string().optional(),
  doi: z.string().optional(),
  arxiv_id: z.string().optional(),
  url: z.string().describe("Landing page"),
  pdf_url: z.string().optional().describe("Free full text, when available"),
  citations: z.number().int().nonnegative().optional(),
  open_access: z.boolean().optional(),
  sources: z.number().int().min(1).describe("How many independent indexes returned this paper"),
});

export const PaperSearchResultSchema = z.object({
  query: z.string(),
  page: z.number().int(),
  sort: PaperSortSchema,
  results: z.array(PaperSchema),
  meta: ResultMetaSchema,
});

export type PaperSearchInput = z.input<typeof PaperSearchInputSchema>;
export type PaperQuery = z.infer<typeof PaperSearchInputSchema>;
export type Paper = z.infer<typeof PaperSchema>;
export type PaperSearchResult = z.infer<typeof PaperSearchResultSchema>;
