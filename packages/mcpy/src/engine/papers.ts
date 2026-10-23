/**
 * Paper search helpers for the engine: routing to capable indexes, and
 * merging the same paper reported by several indexes.
 */

import { ErrorCode, PaperSort } from "../enums.js";
import { McpyError } from "../errors.js";
import type { FoundPaper, PaperProvider, PaperRequest } from "../providers/paper-types.js";
import { RRF_K } from "./merge.js";

export interface MergedPaper extends FoundPaper {
  sources: number;
}

function gap(provider: PaperProvider, req: PaperRequest): string | undefined {
  const caps = provider.capabilities;
  if (!caps.sorts.includes(req.sort)) return `sort ${req.sort}`;
  if ((req.yearFrom !== undefined || req.yearTo !== undefined) && !caps.yearFilter) return "year filter";
  if (req.openAccess && !caps.openAccessFilter) return "open access filter";
  if (req.page * req.limit > caps.maxDepth) return `results beyond ${caps.maxDepth}`;
  return undefined;
}

/** Indexes able to serve the request, in configured order; errors name capabilities, never indexes. */
export function capablePaperProviders(providers: PaperProvider[], req: PaperRequest): PaperProvider[] {
  if (providers.length === 0) throw new McpyError(ErrorCode.NoProviders, "no paper indexes are configured");
  const capable = providers.filter((p) => gap(p, req) === undefined);
  if (capable.length === 0) {
    const missing = [...new Set(providers.map((p) => gap(p, req)).filter((g): g is string => !!g))];
    throw new McpyError(ErrorCode.InvalidInput, "no configured paper index supports this request", missing.map((m) => `unsupported: ${m}`));
  }
  return capable;
}

/** Normalized title: lowercase letters and digits only. */
export function titleKey(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
}

/** Every identity a paper is known by; two records are one paper if any key matches. */
export function paperKeys(p: FoundPaper): string[] {
  const keys = [`title:${titleKey(p.title)}`];
  if (p.doi) keys.push(`doi:${p.doi.toLowerCase()}`);
  if (p.arxivId) keys.push(`arxiv:${p.arxivId.toLowerCase()}`);
  return keys;
}

function fill(into: MergedPaper, from: FoundPaper): void {
  for (const [key, value] of Object.entries(from) as [keyof FoundPaper, unknown][]) {
    const current = into[key];
    if (value === undefined || value === "") continue;
    if (current === undefined || current === "" || (Array.isArray(current) && current.length === 0)) {
      (into as unknown as Record<string, unknown>)[key] = value;
    }
  }
  // Indexes count citations differently; the highest count is the most complete.
  if (from.citations !== undefined && (into.citations === undefined || from.citations > into.citations)) into.citations = from.citations;
  if (from.openAccess) into.openAccess = true;
}

const dateOf = (p: FoundPaper) => p.published ?? (p.year !== undefined ? `${p.year}` : "");

/**
 * Merge ranked lists (one per index) into one ranking. Relevance uses
 * reciprocal rank fusion; citations and newest re-sort the merged papers.
 */
export function mergePapers(lists: FoundPaper[][], limit: number, sort: PaperSort): MergedPaper[] {
  const entries: { paper: MergedPaper; score: number }[] = [];
  const byKey = new Map<string, { paper: MergedPaper; score: number }>();
  for (const list of lists) {
    const seen = new Set<object>();
    list.forEach((paper, rank) => {
      const keys = paperKeys(paper);
      const entry = keys.map((k) => byKey.get(k)).find((e) => e !== undefined);
      const score = 1 / (RRF_K + rank + 1);
      if (entry) {
        if (seen.has(entry)) return; // one index listing the same paper twice counts once
        seen.add(entry);
        entry.score += score;
        entry.paper.sources += 1;
        fill(entry.paper, paper);
        for (const k of paperKeys(entry.paper)) byKey.set(k, entry);
      } else {
        const created = { paper: { ...paper, sources: 1 }, score };
        seen.add(created);
        entries.push(created);
        for (const k of keys) byKey.set(k, created);
      }
    });
  }
  const ranked = entries.sort((a, b) => {
    if (sort === PaperSort.Citations) return (b.paper.citations ?? -1) - (a.paper.citations ?? -1) || b.score - a.score;
    if (sort === PaperSort.Newest) return dateOf(b.paper).localeCompare(dateOf(a.paper)) || b.score - a.score;
    return b.score - a.score || b.paper.sources - a.paper.sources;
  });
  return ranked.slice(0, limit).map((e) => e.paper);
}
