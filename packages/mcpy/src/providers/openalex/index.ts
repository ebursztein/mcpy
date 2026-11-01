import { ErrorCode, PaperSort } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { bareArxivId, bareDoi, type FoundPaper, type PaperCapabilities, type PaperProvider, type PaperRequest } from "../paper-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { AuthorsResponseSchema, SELECT_FIELDS, WorkSchema, WorksResponseSchema, type Work } from "./schemas.js";

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
const AUTHORS_API = "https://api.openalex.org/authors";
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
  authorFilter: true,
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
/** Words in a query short enough to be matched as an exact phrase. */
const PHRASE_MAX_WORDS = 4;

/**
 * Query for the title+abstract filter. Short queries are matched as a
 * phrase: as loose words, "diffusion models" matched AlphaFold 3 and a
 * COVID paper whose abstracts merely contain both words (seen live).
 */
export function titleAbstractQuery(query: string): string {
  // "," separates filters and "|" means OR inside a filter value.
  const clean = query.replace(/[,|]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.includes('"')) return clean;
  const words = clean.split(" ").length;
  return words >= 2 && words <= PHRASE_MAX_WORDS ? `"${clean}"` : clean;
}

/** "," and "|" are filter syntax; strip them from free text used in a filter value. */
const filterValue = (text: string) => text.replace(/[,|]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Filter restricting works to one author. The name is resolved to the best
 * matching OpenAlex author profile first: matching the raw name string found
 * 120 of 139 works for a sample author (seen live). Without a profile, fall
 * back to the raw name.
 */
export async function authorFilter(name: string, call: ProviderCall, apiKey?: string): Promise<string> {
  const url = new URL(AUTHORS_API);
  url.searchParams.set("search", filterValue(name));
  url.searchParams.set("per-page", "1");
  url.searchParams.set("select", "id");
  if (apiKey) url.searchParams.set("api_key", apiKey);
  const { response, data } = await call.http.json({ url: url.toString() }, AuthorsResponseSchema, call.context);
  if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status} (author lookup)`, response.status);
  const id = data.results[0]?.id.split("/").pop();
  return id ? `authorships.author.id:${id}` : `raw_author_name.search:${filterValue(name)}`;
}

/** `author`: a filter from authorFilter(), when the request names an author. */
export function worksUrl(req: PaperRequest, apiKey?: string, today = new Date().toISOString().slice(0, 10), author?: string): string {
  const url = new URL(API);
  const filters: string[] = [];
  if (req.query && req.sort === PaperSort.Relevance) {
    url.searchParams.set("search", req.query);
  } else if (req.query) {
    filters.push(`title_and_abstract.search:${titleAbstractQuery(req.query)}`);
  }
  if (author) filters.push(author);
  // Retracted papers are never what a caller wants (seen live: one ranked #3 by citations).
  filters.push("is_retracted:false");
  url.searchParams.set("per-page", String(req.limit));
  url.searchParams.set("page", String(req.page));
  url.searchParams.set("select", SELECT_FIELDS);
  // Relevance needs a query to score against; an author's papers alone rank by citations.
  url.searchParams.set("sort", req.query ? SORT[req.sort] : SORT[PaperSort.Citations]);
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
      const author = req.author ? await authorFilter(req.author, call, options.apiKey) : undefined;
      const url = worksUrl(req, options.apiKey, undefined, author);
      const { response, data } = await call.http.json({ url }, WorksResponseSchema, call.context);
      if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
      return data.results.flatMap((raw) => {
        const work = WorkSchema.safeParse(raw);
        const paper = work.success ? toPaper(work.data) : undefined;
        return paper ? [paper] : [];
      });
    },
  };
}
