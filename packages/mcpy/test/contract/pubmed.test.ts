/** PubMed against E-utilities responses captured live on 2026-10-22. */

import { describe, expect, it } from "vitest";
import { ErrorCode, PaperCollection, PaperSort } from "mcpy";
import { pubmed, type PaperRequest } from "mcpy/providers";
import { esearchUrl } from "../../src/providers/pubmed/index.js";
import { availableDate, ncbiDate, parseAbstracts } from "../../src/providers/pubmed/parse.js";
import { fixture, stubFetch } from "../helpers.js";
import { failureOf, providerCall } from "./call.js";

const req = (over: Partial<PaperRequest> = {}): PaperRequest => ({
  query: "crispr base editing",
  limit: 3,
  page: 1,
  openAccess: false,
  sort: PaperSort.Relevance,
  collection: PaperCollection.Biomedical,
  ...over,
});
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

/** Answers esearch, esummary and efetch from the live fixtures. */
const eutils = (efetch: () => Response = () => new Response(fixture("pubmed-efetch.xml"), { headers: { "content-type": "text/xml" } })) =>
  stubFetch((url) => {
    if (url.includes("esearch")) return new Response(fixture("pubmed-esearch.json"), { headers: { "content-type": "application/json" } });
    if (url.includes("esummary")) return new Response(fixture("pubmed-esummary.json"), { headers: { "content-type": "application/json" } });
    return efetch();
  });

describe("pubmed: request", () => {
  it("maps paging, sort, year range, open access and identifies the tool", () => {
    const p = params(esearchUrl(req({ page: 2, limit: 5, yearFrom: 2020, yearTo: 2024, openAccess: true }), { apiKey: "k", email: "me@example.com" }));
    expect(p).toMatchObject({
      db: "pubmed",
      term: "(crispr base editing) AND free full text[sb]",
      retmax: "5",
      retstart: "5",
      sort: "relevance",
      datetype: "pdat",
      mindate: "2020",
      maxdate: "2024",
      tool: "mcpy",
      email: "me@example.com",
      api_key: "k",
    });
  });

  // Regression: newest returned forthcoming 2027 books.
  it("caps newest at today", () => {
    expect(params(esearchUrl(req({ sort: PaperSort.Newest }), {}, "2026-10-22"))).toMatchObject({ sort: "pub_date", mindate: "1800", maxdate: "2026/10/22" });
  });
});

describe("pubmed: mapping the live responses", () => {
  it("keeps esearch order and maps title, authors, journal, DOI, PMC full text and abstract", async () => {
    const { fetch, calls } = eutils();
    const papers = await pubmed().searchPapers(req(), providerCall(fetch));
    expect(papers.map((p) => p.url)).toEqual([
      "https://pubmed.ncbi.nlm.nih.gov/38786024/",
      "https://pubmed.ncbi.nlm.nih.gov/38308006/",
      "https://pubmed.ncbi.nlm.nih.gov/38909984/",
    ]);
    expect(papers[0]).toMatchObject({
      title: "CRISPR-Based Gene Therapies: From Preclinical to Clinical Treatments.",
      venue: "Cells",
      doi: "10.3390/cells13100800",
      pdfUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11119143/",
      openAccess: true,
      published: "2024-05-08",
      year: 2024,
    });
    expect(papers[0].authors.slice(0, 2)).toEqual(["Laurent M", "Geoffroy M"]);
    expect(papers[0].abstract).toMatch(/^In recent years, clustered regularly interspaced/);
    expect(calls.map((c) => new URL(c.url).pathname.split("/").pop()).sort()).toEqual(["efetch.fcgi", "esearch.fcgi", "esummary.fcgi"]);
  });

  it("still returns papers when the abstract call fails", async () => {
    const { fetch } = eutils(() => new Response("busy", { status: 503 }));
    const papers = await pubmed().searchPapers(req(), providerCall(fetch));
    expect(papers).toHaveLength(3);
    expect(papers[0].abstract).toBeUndefined();
  });

  it("returns nothing (one call) when esearch finds nothing, and fails on HTTP errors", async () => {
    const empty = stubFetch(() => new Response(JSON.stringify({ esearchresult: { idlist: [], count: "0" } }), { headers: { "content-type": "application/json" } }));
    expect(await pubmed().searchPapers(req(), providerCall(empty.fetch))).toEqual([]);
    expect(empty.calls).toHaveLength(1);
    const down = stubFetch(() => new Response("{}", { status: 500, headers: { "content-type": "application/json" } }));
    expect((await failureOf(pubmed().searchPapers(req(), providerCall(down.fetch)))).code).toBe(ErrorCode.UpstreamFailed);
  });
});

describe("pubmed: parsing details", () => {
  it("keeps structured-abstract labels and strips inline markup", () => {
    const xml = `<PubmedArticle><PMID Version="1">1</PMID><AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">CO<sub>2</sub> &amp; <i>E. coli</i>.</AbstractText>
      <AbstractText Label="RESULTS">It works.</AbstractText></PubmedArticle>`;
    expect(parseAbstracts(xml).get("1")).toBe("BACKGROUND: CO2 & E. coli. RESULTS: It works.");
  });

  // Regression: articles online in 2026 for a January 2027 issue looked future-dated.
  it("dates a paper by when it became available: earlier of online and issue date", () => {
    expect(availableDate({ sortpubdate: "2027/01/01 00:00", epubdate: "2026 Sep 26" })).toBe("2026-09-26");
    expect(availableDate({ sortpubdate: "2024/05/08 00:00", epubdate: "" })).toBe("2024-05-08");
    expect(ncbiDate("2026 Sep")).toBe("2026-09-01");
    expect(ncbiDate("2025")).toBe("2025-01-01");
    expect(ncbiDate("soon")).toBeUndefined();
  });
});
