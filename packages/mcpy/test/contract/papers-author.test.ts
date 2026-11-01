/**
 * Author filters, per index. Query forms were checked live on 2026-10-31
 * (arXiv au: terms, PubMed [au], OpenAlex author profiles).
 */

import { describe, expect, it } from "vitest";
import { PaperSort } from "mcpy";
import { openAlex, semanticScholar, type PaperRequest } from "mcpy/providers";
import { arxivQuery } from "../../src/providers/arxiv/index.js";
import { worksUrl } from "../../src/providers/openalex/index.js";
import { pubmedTerm } from "../../src/providers/pubmed/index.js";
import { fixture, stubFetch } from "../helpers.js";
import { json, providerCall } from "./call.js";

const req = (over: Partial<PaperRequest> = {}): PaperRequest => ({ limit: 3, page: 1, openAccess: false, sort: PaperSort.Relevance, ...over });
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("openalex: author", () => {
  const works = () => new Response(fixture("openalex-works.json"), { headers: { "content-type": "application/json" } });

  it("resolves the name to an author profile, then filters works by its id", async () => {
    const { fetch, calls } = stubFetch((url) => (url.includes("/authors") ? json({ results: [{ id: "https://openalex.org/A5058819105" }] }) : works()));
    const papers = await openAlex({ apiKey: "k" }).searchPapers(req({ author: "Elie Bursztein", sort: PaperSort.Citations }), providerCall(fetch));
    expect(papers.length).toBeGreaterThan(0);
    expect(params(calls[0].url)).toMatchObject({ search: "Elie Bursztein", "per-page": "1", api_key: "k" });
    expect(params(calls[1].url).filter).toBe("authorships.author.id:A5058819105,is_retracted:false");
  });

  it("falls back to the raw name when no profile matches", async () => {
    const { fetch, calls } = stubFetch((url) => (url.includes("/authors") ? json({ results: [] }) : works()));
    await openAlex().searchPapers(req({ author: "Ada, Lovelace|x" }), providerCall(fetch));
    expect(params(calls[1].url).filter).toBe("raw_author_name.search:Ada Lovelace x,is_retracted:false");
  });

  it("ranks an author's papers by citations when there is no query to score", () => {
    const p = params(worksUrl(req(), undefined, undefined, "authorships.author.id:A1"));
    expect(p).not.toHaveProperty("search");
    expect(p.sort).toBe("cited_by_count:desc");
  });

  it("combines a topic with the author", () => {
    const p = params(worksUrl(req({ query: "captcha", sort: PaperSort.Citations }), undefined, undefined, "authorships.author.id:A1"));
    expect(p.filter).toBe("title_and_abstract.search:captcha,authorships.author.id:A1,is_retracted:false");
  });
});

describe("arxiv: author", () => {
  it("makes one au: term per name word, so name order does not matter", () => {
    expect(arxivQuery(req({ author: "Elie Bursztein" }))).toBe("au:Elie AND au:Bursztein");
    expect(arxivQuery(req({ author: "Bursztein, Elie", query: "vectorizer" }))).toBe("all:vectorizer AND au:Bursztein AND au:Elie");
  });
});

describe("pubmed: author", () => {
  it("tags the unquoted name as an author and keeps the other filters", () => {
    expect(pubmedTerm(req({ author: "Eric Topol" }))).toBe("Eric Topol[au]");
    expect(pubmedTerm(req({ author: '"Eric" [Topol]', query: "wearables", openAccess: true }))).toBe("(wearables) AND Eric Topol[au] AND free full text[sb]");
  });
});

describe("semantic scholar: author", () => {
  it("declares that it cannot filter by author", () => {
    expect(semanticScholar({ apiKey: "k" }).capabilities.authorFilter).toBe(false);
  });
});
