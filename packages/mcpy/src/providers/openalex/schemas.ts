import { z } from "zod";

const text = z.string().nullish();

/** One work, with the fields requested via `select` (verified live 2026-10-22). */
export const WorkSchema = z.object({
  id: z.string(),
  doi: text,
  display_name: text,
  title: text,
  publication_year: z.number().nullish(),
  publication_date: text,
  cited_by_count: z.number().nullish(),
  abstract_inverted_index: z.record(z.string(), z.array(z.number())).nullish(),
  authorships: z
    .array(z.object({ author: z.object({ display_name: text }).nullish() }))
    .nullish(),
  primary_location: z
    .object({
      landing_page_url: text,
      pdf_url: text,
      source: z.object({ display_name: text }).nullish(),
    })
    .nullish(),
  best_oa_location: z.object({ pdf_url: text, landing_page_url: text }).nullish(),
  open_access: z.object({ is_oa: z.boolean().nullish(), oa_url: text }).nullish(),
});
export type Work = z.infer<typeof WorkSchema>;

export const WorksResponseSchema = z.object({
  results: z.array(z.unknown()),
  meta: z.object({ count: z.number().nullish() }).partial().nullish(),
});

export const SELECT_FIELDS = [
  "id",
  "doi",
  "display_name",
  "title",
  "publication_year",
  "publication_date",
  "cited_by_count",
  "abstract_inverted_index",
  "authorships",
  "primary_location",
  "best_oa_location",
  "open_access",
].join(",");
