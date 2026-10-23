/**
 * NCBI E-utilities responses -> papers. esearch and esummary are JSON
 * (validated with zod); efetch abstracts are XML, read with a small tag
 * reader (structured abstracts keep their section labels).
 */

import { z } from "zod";
import { decodeXml } from "../arxiv/parse.js";
import { bareDoi, type FoundPaper } from "../paper-types.js";

export const EsearchSchema = z.object({
  esearchresult: z.object({ idlist: z.array(z.string()), count: z.string().optional() }),
});

const text = z.string().nullish();
export const SummaryItem = z.object({
  uid: z.string(),
  title: text,
  authors: z.array(z.object({ name: text })).nullish(),
  pubdate: text,
  epubdate: text,
  sortpubdate: text,
  fulljournalname: text,
  source: text,
  articleids: z.array(z.object({ idtype: z.string(), value: z.string() })).nullish(),
  elocationid: text,
});
export type SummaryItem = z.infer<typeof SummaryItem>;

export const EsummarySchema = z.object({
  result: z.object({ uids: z.array(z.string()) }).catchall(z.unknown()),
});

/** "2024/05/08 00:00" -> "2024-05-08". */
function isoDate(sortpubdate: string | null | undefined): string | undefined {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(sortpubdate ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** NCBI display dates: "2026 Sep 1", "2026 Sep", "2026" -> ISO. */
export function ncbiDate(raw: string | null | undefined): string | undefined {
  const m = /^(\d{4})(?:\s+([A-Za-z]{3}))?(?:\s+(\d{1,2}))?/.exec(raw?.trim() ?? "");
  if (!m) return undefined;
  const month = m[2] ? MONTHS[m[2].toLowerCase()] : undefined;
  return `${m[1]}-${month ?? "01"}-${(m[3] ?? "1").padStart(2, "0")}`;
}

/**
 * When the paper became available: the earlier of the online (epub) date and
 * the issue date. Articles published online in 2026 for a January 2027 issue
 * otherwise look like they come from the future (seen live).
 */
export function availableDate(item: { sortpubdate?: string | null; epubdate?: string | null }): string | undefined {
  const dates = [isoDate(item.sortpubdate), ncbiDate(item.epubdate)].filter((d): d is string => !!d);
  return dates.sort()[0];
}

/** Abstracts by PMID from an efetch XML document. */
export function parseAbstracts(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, article] of xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)) {
    const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(article)?.[1];
    if (!pmid) continue;
    const parts = [...article.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map(([, attrs, body]) => {
      const label = /Label="([^"]+)"/.exec(attrs)?.[1];
      const plain = decodeXml(body.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      return label ? `${label}: ${plain}` : plain;
    });
    const abstract = parts.filter(Boolean).join(" ");
    if (abstract) out.set(pmid, abstract);
  }
  return out;
}

export function toPaper(item: SummaryItem, abstract: string | undefined): FoundPaper | undefined {
  const title = item.title?.replace(/\s+/g, " ").trim();
  if (!title) return undefined;
  const ids = new Map((item.articleids ?? []).map((a) => [a.idtype, a.value]));
  const pmc = ids.get("pmc");
  const published = availableDate(item);
  return {
    title,
    authors: (item.authors ?? []).flatMap((a) => (a.name ? [a.name] : [])),
    year: published ? Number(published.slice(0, 4)) : undefined,
    published,
    venue: item.fulljournalname ?? item.source ?? undefined,
    abstract,
    doi: bareDoi(ids.get("doi") ?? item.elocationid?.match(/doi:\s*(\S+)/)?.[1]),
    url: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`,
    // PubMed Central hosts the free full text when there is a PMC id.
    pdfUrl: pmc ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmc}/` : undefined,
    openAccess: pmc ? true : undefined,
  };
}
