import { z } from "zod";

/** Every Firecrawl v2 response: `{ success, data?, error?, code? }`. */
function envelope<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.boolean(),
    data: data.optional(),
    error: z.string().optional(),
    code: z.string().optional(),
  });
}

export const ScrapeResponseSchema = envelope(
  z.object({
    markdown: z.string().optional(),
    rawHtml: z.string().optional(),
    metadata: z
      .object({
        title: z.union([z.string(), z.array(z.string())]).optional(),
        url: z.string().optional(),
        sourceURL: z.string().optional(),
        statusCode: z.number().optional(),
        contentType: z.string().optional(),
      })
      .optional(),
  }),
);

const SearchItem = z.object({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  snippet: z.string().optional(),
  date: z.string().optional(),
  imageUrl: z.string().optional(),
});

/** v2 search: one array per requested source. */
export const SearchResponseSchema = envelope(
  z.object({
    web: z.array(SearchItem).optional(),
    news: z.array(SearchItem).optional(),
    images: z.array(SearchItem).optional(),
  }),
);
