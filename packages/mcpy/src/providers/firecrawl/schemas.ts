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

export const SearchResponseSchema = envelope(
  z.object({
    web: z
      .array(
        z.object({
          url: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
        }),
      )
      .optional(),
  }),
);
