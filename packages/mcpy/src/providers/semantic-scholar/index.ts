/**
 * Semantic Scholar Graph API paper search. Requires an API key in practice:
 * the shared unauthenticated pool answered 429 to every request when
 * verified on 2026-10-22. Response handling follows the documented shape and
 * has not been exercised live.
 */

import { z } from "zod";
import { ErrorCode, PaperSort } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { bareArxivId, bareDoi, type PaperCapabilities, type PaperProvider, type PaperRequest } from "../paper-types.js";
import { ProviderId } from "../types.js";

export interface SemanticScholarOptions {
  apiKey: string;
  costPerCall?: number;
}

const API = "https://api.semanticscholar.org/graph/v1/paper/search";
const FIELDS = "title,authors,year,venue,abstract,externalIds,url,openAccessPdf,citationCount,publicationDate,isOpenAccess";
/** offset + limit must stay below 1,000 on this endpoint. */
const MAX_DEPTH = 1_000;

const text = z.string().nullish();
const PaperItem = z.object({
  title: z.string(),
  authors: z.array(z.object({ name: text })).nullish(),
  year: z.number().nullish(),
  venue: text,
  abstract: text,
  externalIds: z.record(z.string(), z.union([z.string(), z.number()])).nullish(),
  url: text,
  openAccessPdf: z.object({ url: text }).nullish(),
  citationCount: z.number().nullish(),
  publicationDate: text,
  isOpenAccess: z.boolean().nullish(),
});
const SearchResponse = z.object({ data: z.array(z.unknown()).nullish() });

export const SEMANTIC_SCHOLAR_CAPABILITIES: PaperCapabilities = {
  sorts: [PaperSort.Relevance],
  yearFilter: true,
  openAccessFilter: true,
  maxDepth: MAX_DEPTH,
};

export function semanticScholarUrl(req: PaperRequest): string {
  const url = new URL(API);
  url.searchParams.set("query", req.query);
  url.searchParams.set("offset", String((req.page - 1) * req.limit));
  url.searchParams.set("limit", String(req.limit));
  url.searchParams.set("fields", FIELDS);
  if (req.yearFrom !== undefined || req.yearTo !== undefined) url.searchParams.set("year", `${req.yearFrom ?? ""}-${req.yearTo ?? ""}`);
  if (req.openAccess) url.searchParams.set("openAccessPdf", "");
  return url.toString();
}

export function semanticScholar(options: SemanticScholarOptions): PaperProvider {
  return {
    id: ProviderId.SemanticScholar,
    costPerCall: options.costPerCall ?? 0,
    capabilities: SEMANTIC_SCHOLAR_CAPABILITIES,
    async searchPapers(req, call) {
      const { response, data } = await call.http.json(
        { url: semanticScholarUrl(req), headers: { "x-api-key": options.apiKey } },
        SearchResponse,
        call.context,
      );
      if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
      return (data.data ?? []).flatMap((raw) => {
        const p = PaperItem.safeParse(raw);
        if (!p.success) return [];
        const ids = p.data.externalIds ?? {};
        return [
          {
            title: p.data.title,
            authors: (p.data.authors ?? []).flatMap((a) => (a.name ? [a.name] : [])),
            year: p.data.year ?? undefined,
            published: p.data.publicationDate ?? undefined,
            venue: p.data.venue || undefined,
            abstract: p.data.abstract ?? undefined,
            doi: bareDoi(ids.DOI !== undefined ? String(ids.DOI) : undefined),
            arxivId: bareArxivId(ids.ArXiv !== undefined ? String(ids.ArXiv) : undefined),
            url: p.data.url ?? `https://www.semanticscholar.org/search?q=${encodeURIComponent(p.data.title)}`,
            pdfUrl: p.data.openAccessPdf?.url || undefined,
            citations: p.data.citationCount ?? undefined,
            openAccess: p.data.isOpenAccess ?? undefined,
          },
        ];
      });
    },
  };
}
