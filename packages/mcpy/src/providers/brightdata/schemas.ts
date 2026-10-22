import { z } from "zod";

/** Web Unlocker `format: "json"` envelope. */
export const UnlockerEnvelopeSchema = z.object({
  status_code: z.number().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});

/** Parsed Google SERP (`brd_json=1`), possibly wrapped in the envelope. */
export const SerpSchema = z.object({
  organic: z
    .array(
      z.object({
        link: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  /** Present on every parsed SERP, including ones with zero results. */
  general: z.unknown().optional(),
  body: z.string().optional(),
});
