import { ErrorCode, PaperCollection, PaperSort } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import type { PaperCapabilities, PaperProvider, PaperRequest } from "../paper-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { EsearchSchema, EsummarySchema, parseAbstracts, SummaryItem, toPaper } from "./parse.js";

export interface PubMedOptions {
  /** Optional NCBI key: raises the limit from 3 to 10 requests per second. */
  apiKey?: string;
  /** Contact address NCBI asks integrations to send (optional). */
  email?: string;
  costPerCall?: number;
}

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
/** esearch pages no further than 10,000 results. */
const MAX_DEPTH = 10_000;

export const PUBMED_CAPABILITIES: PaperCapabilities = {
  // PubMed has no citation counts.
  sorts: [PaperSort.Relevance, PaperSort.Newest],
  yearFilter: true,
  openAccessFilter: true,
  maxDepth: MAX_DEPTH,
  collections: [PaperCollection.Biomedical],
};

function eutils(path: string, params: Record<string, string>, options: PubMedOptions): string {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("tool", "mcpy");
  if (options.email) url.searchParams.set("email", options.email);
  if (options.apiKey) url.searchParams.set("api_key", options.apiKey);
  return url.toString();
}

export function esearchUrl(req: PaperRequest, options: PubMedOptions = {}, today = new Date().toISOString().slice(0, 10)): string {
  const params: Record<string, string> = {
    db: "pubmed",
    term: req.openAccess ? `(${req.query}) AND free full text[sb]` : req.query,
    retmax: String(req.limit),
    retstart: String((req.page - 1) * req.limit),
    retmode: "json",
    sort: req.sort === PaperSort.Newest ? "pub_date" : "relevance",
  };
  // Newest first must not surface future-dated records (seen live: 2027 book chapters).
  const capAtToday = req.sort === PaperSort.Newest && req.yearTo === undefined;
  if (req.yearFrom !== undefined || req.yearTo !== undefined || capAtToday) {
    const maxdate = capAtToday ? today.replaceAll("-", "/") : String(req.yearTo ?? 3000);
    Object.assign(params, { datetype: "pdat", mindate: String(req.yearFrom ?? 1800), maxdate });
  }
  return eutils("esearch.fcgi", params, options);
}

async function check(promise: ReturnType<ProviderCall["http"]["send"]>) {
  const response = await promise;
  if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
  return response;
}

/**
 * PubMed (NCBI E-utilities): 37M+ biomedical citations. Three calls:
 * esearch (ids, in order) -> esummary (metadata) -> efetch (abstracts).
 * Abstracts are best effort: if efetch fails, results come without them.
 */
export function pubmed(options: PubMedOptions = {}): PaperProvider {
  return {
    id: ProviderId.PubMed,
    costPerCall: options.costPerCall ?? 0,
    capabilities: PUBMED_CAPABILITIES,
    async searchPapers(req, call) {
      const { response, data: search } = await call.http.json({ url: esearchUrl(req, options) }, EsearchSchema, call.context);
      if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
      const ids = search.esearchresult.idlist;
      if (ids.length === 0) return [];

      const [summary, abstracts] = await Promise.all([
        call.http.json({ url: eutils("esummary.fcgi", { db: "pubmed", id: ids.join(","), retmode: "json" }, options) }, EsummarySchema, call.context),
        check(call.http.send({ url: eutils("efetch.fcgi", { db: "pubmed", id: ids.join(","), rettype: "abstract", retmode: "xml" }, options) }, { ...call.context, maxBytes: call.context.maxBytes * 2 }))
          .then((r) => parseAbstracts(r.text))
          .catch(() => new Map<string, string>()),
      ]);
      if (summary.response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${summary.response.status}`, summary.response.status);

      // Keep esearch's order (relevance or date); esummary returns a map.
      return ids.flatMap((id) => {
        const item = SummaryItem.safeParse(summary.data.result[id]);
        const paper = item.success ? toPaper(item.data, abstracts.get(id)) : undefined;
        return paper ? [paper] : [];
      });
    },
  };
}
