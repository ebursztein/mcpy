/**
 * arXiv API Atom feed -> papers. The feed is flat and regular, so a small
 * tag reader is enough (no DOM in Workers); every field is optional except
 * the id and title, and malformed entries are skipped.
 */

import { bareArxivId, bareDoi, type FoundPaper } from "../paper-types.js";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)));
}

const clean = (t: string | undefined) => (t === undefined ? undefined : decodeXml(t).replace(/\s+/g, " ").trim() || undefined);

/** Text of the first <tag>...</tag> (namespaced tags like arxiv:doi work too). */
function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m?.[1];
}

function allTags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);
}

/** href of the first <link .../> whose attributes match. */
function link(xml: string, attr: RegExp): string | undefined {
  for (const m of xml.matchAll(/<link\s([^>]*?)\/?>/g)) {
    if (attr.test(m[1])) return /href="([^"]+)"/.exec(m[1])?.[1];
  }
  return undefined;
}

export function parseArxivFeed(xml: string): FoundPaper[] {
  return allTags(xml, "entry").flatMap((entry) => {
    const id = clean(tag(entry, "id"));
    const title = clean(tag(entry, "title"));
    const arxivId = bareArxivId(id);
    if (!id || !title || !arxivId) return []; // includes arXiv's error entries (id .../api/errors)
    const published = clean(tag(entry, "published"));
    const abs = link(entry, /rel="alternate"/) ?? `https://arxiv.org/abs/${arxivId}`;
    return [
      {
        title,
        authors: allTags(entry, "author").flatMap((a) => {
          const name = clean(tag(a, "name"));
          return name ? [name] : [];
        }),
        year: published ? Number(published.slice(0, 4)) : undefined,
        published: published?.slice(0, 10),
        venue: clean(tag(entry, "arxiv:journal_ref")) ?? "arXiv",
        abstract: clean(tag(entry, "summary")),
        // Every arXiv paper has a DataCite DOI; a journal DOI wins when given.
        doi: bareDoi(clean(tag(entry, "arxiv:doi"))) ?? `10.48550/arxiv.${arxivId.toLowerCase()}`,
        arxivId,
        url: abs.replace(/^http:/, "https:"),
        pdfUrl: (link(entry, /title="pdf"/) ?? `https://arxiv.org/pdf/${arxivId}`).replace(/^http:/, "https:"),
        openAccess: true,
      },
    ];
  });
}

/** Total hits reported by the feed (opensearch:totalResults). */
export function totalResults(xml: string): number | undefined {
  const n = Number(tag(xml, "opensearch:totalResults"));
  return Number.isFinite(n) ? n : undefined;
}
