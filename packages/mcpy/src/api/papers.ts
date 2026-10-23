import type { z } from "zod";
import { clip } from "../content/text.js";
import type { CallScope, Engine, Served } from "../engine/engine.js";
import type { MergedPaper } from "../engine/papers.js";
import { MAX_AUTHORS, PaperSearchResultSchema, type Paper, type PaperSearchInputSchema, type PaperSearchResult } from "../schemas-papers.js";

/** Abstracts are capped: a page of 50 papers must stay readable for an LLM. */
export const MAX_ABSTRACT_CHARS = 1_200;

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

const tidy = (v: string | undefined, max: number) => (v ? clip(v.replace(/\s+/g, " ").trim(), max) : undefined);

function toPaper(p: MergedPaper): Paper {
  return compact({
    title: tidy(p.title, 400) ?? p.url,
    authors: p.authors.slice(0, MAX_AUTHORS),
    authors_total: p.authors.length,
    year: p.year,
    published: p.published,
    venue: tidy(p.venue, 200),
    abstract: tidy(p.abstract, MAX_ABSTRACT_CHARS),
    doi: p.doi,
    arxiv_id: p.arxivId,
    url: p.url,
    pdf_url: p.pdfUrl,
    citations: p.citations,
    open_access: p.openAccess,
    sources: p.sources,
  });
}

export async function papersOp(
  engine: Engine,
  input: z.infer<typeof PaperSearchInputSchema>,
  scope: CallScope,
): Promise<{ result: PaperSearchResult; served: Served<unknown>; outputChars: number }> {
  const startedAt = Date.now();
  const served = await engine.papers(
    {
      query: input.query,
      limit: input.max_results,
      page: input.page,
      yearFrom: input.year_from,
      yearTo: input.year_to,
      openAccess: input.open_access,
      sort: input.sort,
    },
    input.mode,
    input.fresh,
    scope,
  );
  const result = PaperSearchResultSchema.parse({
    query: input.query,
    page: input.page,
    sort: input.sort,
    results: served.value.map(toPaper),
    meta: { cache: served.cache, latency_ms: Date.now() - startedAt, attempts: served.attempts },
  });
  const outputChars = result.results.reduce((n, p) => n + p.title.length + (p.abstract?.length ?? 0), 0);
  return { result, served, outputChars };
}
