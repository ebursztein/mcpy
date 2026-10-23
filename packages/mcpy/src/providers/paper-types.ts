/** Contract for paper indexes (OpenAlex, arXiv, Semantic Scholar, your own). */

import type { PaperSort } from "../enums.js";
import type { ProviderCall } from "./types.js";

export interface PaperRequest {
  query: string;
  /** Results wanted on this page. */
  limit: number;
  /** 1-based page: skip (page - 1) * limit results. */
  page: number;
  yearFrom?: number;
  yearTo?: number;
  openAccess: boolean;
  sort: PaperSort;
}

/** A paper as an index returned it. */
export interface FoundPaper {
  title: string;
  /** All authors, in order; the operation trims the list for output. */
  authors: string[];
  year?: number;
  published?: string;
  venue?: string;
  abstract?: string;
  /** Bare DOI, e.g. 10.48550/arXiv.1706.03762 (no https://doi.org/). */
  doi?: string;
  /** Bare arXiv id without version, e.g. 1706.03762. */
  arxivId?: string;
  url: string;
  pdfUrl?: string;
  citations?: number;
  openAccess?: boolean;
}

/** What an index can honor; requests are routed only to capable indexes. */
export interface PaperCapabilities {
  sorts: readonly PaperSort[];
  yearFilter: boolean;
  openAccessFilter: boolean;
  /** Deepest result reachable: page * limit must not exceed it. */
  maxDepth: number;
}

export interface PaperProvider {
  readonly id: string;
  readonly costPerCall: number;
  readonly capabilities: PaperCapabilities;
  readonly circuitBreaker?: boolean;
  readonly attemptTimeoutMs?: number;
  searchPapers(req: PaperRequest, call: ProviderCall): Promise<FoundPaper[]>;
}

/** "https://doi.org/10.1/ABC" -> "10.1/abc" (DOIs are case-insensitive). */
export function bareDoi(raw: string | undefined | null): string | undefined {
  const doi = raw?.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "");
  return doi ? doi.toLowerCase() : undefined;
}

/** "http://arxiv.org/abs/1706.03762v7" or "1706.03762v7" -> "1706.03762". */
export function bareArxivId(raw: string | undefined | null): string | undefined {
  const m = /(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i.exec(raw?.trim() ?? "");
  return m ? m[1] : undefined;
}
