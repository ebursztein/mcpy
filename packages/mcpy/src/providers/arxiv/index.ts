import { ErrorCode, PaperSort } from "../../enums.js";
import { sleep } from "../../http/retry.js";
import { ProviderFailure } from "../../errors.js";
import type { PaperCapabilities, PaperProvider, PaperRequest } from "../paper-types.js";
import { ProviderId } from "../types.js";
import { parseArxivFeed } from "./parse.js";

export interface ArxivOptions {
  costPerCall?: number;
  /** Minimum gap between requests; arXiv's API terms ask for 3 s. */
  spacingMs?: number;
}

const API = "https://export.arxiv.org/api/query";
/** arXiv caps paging at 30,000 results per query. */
const MAX_DEPTH = 30_000;

export const ARXIV_CAPABILITIES: PaperCapabilities = {
  // arXiv has no citation counts.
  sorts: [PaperSort.Relevance, PaperSort.Newest],
  yearFilter: true,
  // Every arXiv paper is open access, so the filter is always satisfied.
  openAccessFilter: true,
  maxDepth: MAX_DEPTH,
};

/** Terms ANDed across all fields, plus an optional submission-date range. */
export function arxivQuery(req: PaperRequest): string {
  const terms = req.query
    .replace(/["()]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/^(and|or|andnot)$/i.test(t))
    .map((t) => `all:${t}`);
  const parts = [terms.join(" AND ") || "all:*"];
  if (req.yearFrom !== undefined || req.yearTo !== undefined) {
    const from = `${req.yearFrom ?? 1991}01010000`;
    const to = `${req.yearTo ?? 2100}12312359`;
    parts.push(`submittedDate:[${from} TO ${to}]`);
  }
  return parts.join(" AND ");
}

export function arxivUrl(req: PaperRequest): string {
  const url = new URL(API);
  url.searchParams.set("search_query", arxivQuery(req));
  url.searchParams.set("start", String((req.page - 1) * req.limit));
  url.searchParams.set("max_results", String(req.limit));
  url.searchParams.set("sortBy", req.sort === PaperSort.Newest ? "submittedDate" : "relevance");
  url.searchParams.set("sortOrder", "descending");
  return url.toString();
}

const POLITE_SPACING_MS = 3_000;
/** Throttled answers seen live (429 with no Retry-After); worth a patient retry. */
const THROTTLED = new Set([429, 503]);
const MAX_TRIES = 3;

/**
 * Serializes requests from one instance so they start at least `spacingMs`
 * apart (per Worker isolate; arXiv rate-limits by IP, so this is a courtesy
 * that also avoids most 429s, not a global guarantee).
 */
function politeGate(spacingMs: number) {
  let next = 0;
  let queue: Promise<void> = Promise.resolve();
  return (signal: AbortSignal): Promise<void> => {
    const turn = queue.then(async () => {
      const wait = next - Date.now();
      if (wait > 0) await sleep(wait, signal);
      next = Date.now() + spacingMs;
    });
    queue = turn.catch(() => undefined);
    return turn;
  };
}

/** arXiv: preprints, often the newest version of a result, always free to read. */
export function arxiv(options: ArxivOptions = {}): PaperProvider {
  const spacingMs = options.spacingMs ?? POLITE_SPACING_MS;
  const gate = politeGate(spacingMs);
  return {
    id: ProviderId.Arxiv,
    costPerCall: options.costPerCall ?? 0,
    capabilities: ARXIV_CAPABILITIES,
    // Measured live: up to ~30 s per query, plus spacing after a 429.
    attemptTimeoutMs: 55_000,
    async searchPapers(req, call) {
      let response;
      for (let attempt = 1; ; attempt++) {
        await gate(call.context.signal).catch((abort) => {
          throw new ProviderFailure(ErrorCode.Timeout, `waiting for arXiv rate limit: ${String(abort)}`);
        });
        response = await call.http.send({ url: arxivUrl(req), headers: { Accept: "application/atom+xml" } }, call.context);
        const throttled = THROTTLED.has(response.status);
        if (!throttled || attempt >= MAX_TRIES || Date.now() + spacingMs * attempt >= call.context.deadlineAt) break;
        // The gate spaces the next try; back off further on repeated throttling.
        await sleep(spacingMs * (attempt - 1), call.context.signal).catch(() => undefined);
      }
      if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
      if (!response.text.includes("<feed")) throw new ProviderFailure(ErrorCode.BadResponse, "arXiv response is not an Atom feed", response.status);
      return parseArxivFeed(response.text);
    },
  };
}
