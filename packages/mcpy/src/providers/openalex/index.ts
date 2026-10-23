import { ErrorCode, PaperSort } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { bareArxivId, bareDoi, type FoundPaper, type PaperCapabilities, type PaperProvider, type PaperRequest } from "../paper-types.js";
import { ProviderId } from "../types.js";
import { SELECT_FIELDS, WorkSchema, WorksResponseSchema, type Work } from "./schemas.js";

export interface OpenAlexOptions {
  /**
   * Free key from openalex.org/settings/api ($1/day of requests). Without
   * it, every caller on the same IP shares one $0.10/day budget: on a
   * shared Worker IP that runs out fast.
   */
  apiKey?: string;
  costPerCall?: number;
}

const API = "https://api.openalex.org/works";
const MAX_DEPTH = 10_000;

const SORT: Record<PaperSort, string> = {
  [PaperSort.Relevance]: "relevance_score:desc",
  [PaperSort.Citations]: "cited_by_count:desc",
  [PaperSort.Newest]: "publication_date:desc",
};

export const OPENALEX_CAPABILITIES: PaperCapabilities = {
  sorts: [PaperSort.Relevance, PaperSort.Citations, PaperSort.Newest],
  yearFilter: true,
  openAccessFilter: true,
  maxDepth: MAX_DEPTH,
  collections: [],
};

/** OpenAlex ships abstracts as an inverted index: word -> positions. */
export function abstractFromIndex(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const at of positions) words[at] = word;
  const text = words.filter((w) => w !== undefined).join(" ").trim();
  return text || undefined;
}

/**
 * OpenAlex's `search` parameter searches full text. That suits relevance
 * ranking (its scoring favors title matches and well-known papers), but when
 * sorting by citations or date any paper that merely mentions the words can
 * win (seen live: a molecular-dynamics tool topped "diffusion models image
 * generation" by citations). Those sorts match title and abstract only.
 */
export function worksUrl(req: PaperRequest, apiKey?: string, today = new Date().toISOString().slice(0, 10)): string {
  const url = new URL(API);
  const filters: string[] = [];
  if (req.sort === PaperSort.Relevance) {
    url.searchParams.set("search", req.query);
  } else {
    // "," separates filters and "|" means OR inside a filter value.
    filters.push(`title_and_abstract.search:${req.query.replace(/[,|]/g, " ").trim()}`);
  }
  url.searchParams.set("per-page", String(req.limit));
  url.searchParams.set("page", String(req.page));
  url.searchParams.set("select", SELECT_FIELDS);
  url.searchParams.set("sort", SORT[req.sort]);
  if (req.yearFrom !== undefined) filters.push(`from_publication_date:${req.yearFrom}-01-01`);
  // Newest first must not surface future-dated records (embargoes, typos).
  const until = req.yearTo !== undefined ? `${req.yearTo}-12-31` : req.sort === PaperSort.Newest ? today : undefined;
  if (until !== undefined) filters.push(`to_publication_date:${until < today ? until : today}`);
  if (req.openAccess) filters.push("is_oa:true");
  if (filters.length) url.searchParams.set("filter", filters.join(","));
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url.toString();
}

export function toPaper(w: Work): FoundPaper | undefined {
  const title = (w.display_name ?? w.title)?.trim();
  if (!title) return undefined;
  const doi = bareDoi(w.doi);
  return {
    title,
    authors: (w.authorships ?? []).flatMap((a) => (a.author?.display_name ? [a.author.display_name] : [])),
    year: w.publication_year ?? undefined,
    published: w.publication_date ?? undefined,
    venue: w.primary_location?.source?.display_name ?? undefined,
    abstract: abstractFromIndex(w.abstract_inverted_index),
    doi,
    arxivId: doi?.startsWith("10.48550/arxiv.") ? bareArxivId(doi.slice("10.48550/arxiv.".length)) : undefined,
    url: w.doi ?? w.primary_location?.landing_page_url ?? w.id,
    pdfUrl: w.best_oa_location?.pdf_url ?? w.primary_location?.pdf_url ?? w.open_access?.oa_url ?? undefined,
    citations: w.cited_by_count ?? undefined,
    openAccess: w.open_access?.is_oa ?? undefined,
  };
}

/** OpenAlex: 250M+ scholarly works with citations, venues and open-access links. */
export function openAlex(options: OpenAlexOptions = {}): PaperProvider {
  return {
    id: ProviderId.OpenAlex,
    costPerCall: options.costPerCall ?? 0.001,
    capabilities: OPENALEX_CAPABILITIES,
    async searchPapers(req, call) {
      const { response, data } = await call.http.json({ url: worksUrl(req, options.apiKey) }, WorksResponseSchema, call.context);
      if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
      return data.results.flatMap((raw) => {
        const work = WorkSchema.safeParse(raw);
        const paper = work.success ? toPaper(work.data) : undefined;
        return paper ? [paper] : [];
      });
    },
  };
}
