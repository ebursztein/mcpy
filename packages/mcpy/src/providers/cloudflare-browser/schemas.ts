import { z } from "zod";

/**
 * Browser Run quick-action response (markdown and content endpoints). Errors
 * use the Cloudflare v4 envelope, where `result` is null.
 */
export const BrowserRunResponseSchema = z.object({
  success: z.boolean(),
  result: z.string().nullish(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })).optional(),
  meta: z
    .object({
      finalUrl: z.string().optional(),
      status: z.number().optional(),
      title: z.string().optional(),
    })
    .optional(),
});
export type BrowserRunResponse = z.infer<typeof BrowserRunResponseSchema>;
