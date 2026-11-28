/** SEC EDGAR answers, as seen live 2026-11-28 (Apple, Microsoft, JPMorgan). */

import { z } from "zod";

/** company_tickers.json: {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, ...} */
export const TickersResponseSchema = z.record(z.string(), z.looseObject({ cik_str: z.number().int().nonnegative(), ticker: z.string().min(1), title: z.string().optional() }));

const FactSchema = z.looseObject({
  /** Absent for balance-sheet (instant) figures. */
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  form: z.string().optional(),
  filed: z.string(),
});

/** companyconcept/CIK##########/<taxonomy>/<tag>.json; a company without the tag answers 404. */
export const ConceptResponseSchema = z.looseObject({
  entityName: z.string().nullable().optional(),
  units: z.record(z.string(), z.array(FactSchema)),
});

export type ConceptFact = z.infer<typeof FactSchema>;
