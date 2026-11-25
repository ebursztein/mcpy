/** How the engine judges a non-page answer, and what it costs; shared by the operations. */

import { AttemptOutcome } from "../enums.js";
import type { SearchProvider, SearchRequest } from "../providers/types.js";
import type { Judgement } from "./chain.js";

/**
 * Search judgement: results are final; no results move on to the next
 * source (seen live: one source found nothing for a site-restricted news
 * search). If every source is empty, the empty answer is still returned.
 */
export function emptyMovesOn(hits: unknown[]): Judgement {
  return hits.length ? { outcome: AttemptOutcome.Ok } : { outcome: AttemptOutcome.Escalate, reason: "no results", salvageable: true };
}

/** What one attempt at this search costs on a provider. */
export const searchCost = (req: SearchRequest) => (p: SearchProvider) => p.costOf?.(req) ?? p.costPerCall;

/** Empty search results may be a transient upstream hiccup: keep them briefly. */
export const EMPTY_SEARCH_TTL_SECONDS = 60;
