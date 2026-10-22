import { describe, expect, it } from "vitest";
import { brightdataFetch, brightdataSearch } from "../src/providers/brightdata";
import { cfBrowser } from "../src/providers/cf-browser";
import { cfFetch } from "../src/providers/cf-fetch";
import { firecrawlFetch, firecrawlSearch } from "../src/providers/firecrawl";
import { resolveFetchProviders, resolveSearchProviders } from "../src/providers/registry";
import { deps, stubFetch } from "./helpers";

const signal = new AbortController().signal;
const md = { url: "https://example.com/post", format: "markdown" as const, timeoutMs: 5000 };
const ARTICLE = `<html><head><title>Post</title></head><body><nav>menu</nav><article><h1>Hello</h1>
<p>${"Body text for the article. ".repeat(30)}</p><p><a href="/next">next</a></p></article></body></html>`;

describe("registry", () => {
  it("enables only providers with credentials, in configured order", () => {
    const { fetch } = stubFetch(() => new Response(""));
    const r = resolveFetchProviders(deps({ FETCH_PROVIDERS: "firecrawl,cf_fetch,brightdata,nope", FIRECRAWL_API_KEY: "k" }, fetch));
    expect(r.chain.map((p) => p.id)).toEqual(["firecrawl", "cf_fetch"]);
    expect(r.skipped).toEqual([
      { id: "brightdata", reason: "missing credentials" },
      { id: "nope", reason: "unknown provider id" },
    ]);
  });

  it("uses the default order when unset", () => {
    const { fetch } = stubFetch(() => new Response(""));
    const env = { FIRECRAWL_API_KEY: "k", BRIGHTDATA_API_KEY: "b", BRIGHTDATA_SERP_ZONE: "serp" };
    expect(resolveSearchProviders(deps(env, fetch)).chain.map((p) => p.id)).toEqual(["firecrawl", "brightdata"]);
  });
});

describe("cf_fetch", () => {
  it("extracts article markdown with absolute links", async () => {
    const { fetch, calls } = stubFetch(() => new Response(ARTICLE, { headers: { "content-type": "text/html; charset=utf-8" } }));
    const p = cfFetch.create(deps({}, fetch))!;
    const r = await p.fetch(md, signal);
    expect(r.title).toBe("Post");
    expect(r.content).toContain("# Hello");
    expect(r.content).toContain("](https://example.com/next)");
    expect(r.content).not.toContain("menu");
    expect(new Headers(calls[0].init?.headers).get("accept")).toMatch(/^text\/markdown/);
  });

  it("passes markdown responses through untouched", async () => {
    const { fetch } = stubFetch(() => new Response("# Already markdown", { headers: { "content-type": "text/markdown" } }));
    const r = await cfFetch.create(deps({}, fetch))!.fetch(md, signal);
    expect(r.content).toBe("# Already markdown");
  });

  it("reads the title from markdown frontmatter", async () => {
    const { fetch } = stubFetch(() => new Response('---\ntitle: Cloudflare Blog\n---\n\n# Posts', { headers: { "content-type": "text/markdown" } }));
    const r = await cfFetch.create(deps({}, fetch))!.fetch(md, signal);
    expect(r).toMatchObject({ title: "Cloudflare Blog", content: "# Posts" });
  });

  it("rejects binary content and oversized bodies", async () => {
    const bin = stubFetch(() => new Response("x", { headers: { "content-type": "image/png" } }));
    await expect(cfFetch.create(deps({}, bin.fetch))!.fetch(md, signal)).rejects.toThrow(/unsupported content type/);
    const big = stubFetch(() => new Response("x".repeat(20_000), { headers: { "content-type": "text/plain" } }));
    await expect(cfFetch.create(deps({ MAX_RESPONSE_BYTES: "10000" }, big.fetch))!.fetch(md, signal)).rejects.toThrow(/exceeds/);
  });
});

describe("cf_browser", () => {
  it("is disabled without credentials", () => {
    expect(cfBrowser.create(deps({}, stubFetch(() => new Response("")).fetch))).toBeNull();
  });

  it("calls Browser Run markdown and strips frontmatter", async () => {
    const { fetch, calls } = stubFetch(() =>
      Response.json({ success: true, result: '---\ntitle: "Rendered"\n---\n# Body', meta: { status: 200, finalUrl: "https://example.com/post/" } }),
    );
    const p = cfBrowser.create(deps({ CF_ACCOUNT_ID: "acc", CF_BROWSER_API_TOKEN: "tok" }, fetch))!;
    const r = await p.fetch(md, signal);
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/browser-run/markdown");
    expect(calls[0].body).toMatchObject({ url: md.url });
    expect(r).toMatchObject({ title: "Rendered", content: "# Body", status: 200, finalUrl: "https://example.com/post/" });
  });

  it("surfaces API errors", async () => {
    const { fetch } = stubFetch(() => Response.json({ success: false, errors: [{ code: 2001, message: "rate limited" }] }, { status: 429 }));
    const p = cfBrowser.create(deps({ CF_ACCOUNT_ID: "acc", CF_BROWSER_API_TOKEN: "tok" }, fetch))!;
    await expect(p.fetch(md, signal)).rejects.toThrow(/2001 rate limited/);
  });
});

describe("firecrawl", () => {
  const env = { FIRECRAWL_API_KEY: "fc-key" };

  it("scrapes markdown with our cache in charge", async () => {
    const { fetch, calls } = stubFetch(() =>
      Response.json({ success: true, data: { markdown: "# Hi", metadata: { title: ["T"], url: "https://example.com/final", statusCode: 200 } } }),
    );
    const r = await firecrawlFetch.create(deps(env, fetch))!.fetch(md, signal);
    expect(calls[0].url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer fc-key");
    expect(calls[0].body).toMatchObject({ url: md.url, formats: ["markdown"], onlyMainContent: true, maxAge: 0 });
    expect(r).toMatchObject({ title: "T", content: "# Hi", status: 200, finalUrl: "https://example.com/final" });
  });

  it("honors a self-hosted API URL", async () => {
    const { fetch, calls } = stubFetch(() => Response.json({ success: true, data: { web: [] } }));
    await firecrawlSearch.create(deps({ ...env, FIRECRAWL_API_URL: "https://fc.internal.example/" }, fetch))!.search({ query: "q", limit: 3, timeoutMs: 1000 }, signal);
    expect(calls[0].url).toBe("https://fc.internal.example/v2/search");
  });

  it("maps search results", async () => {
    const { fetch } = stubFetch(() => Response.json({ success: true, data: { web: [{ url: "https://a", title: "A", description: "d" }] } }));
    const hits = await firecrawlSearch.create(deps(env, fetch))!.search({ query: "q", limit: 3, timeoutMs: 1000 }, signal);
    expect(hits).toEqual([{ url: "https://a", title: "A", snippet: "d" }]);
  });

  it("reports API errors", async () => {
    const { fetch } = stubFetch(() => Response.json({ success: false, error: "Insufficient credits" }, { status: 402 }));
    await expect(firecrawlFetch.create(deps(env, fetch))!.fetch(md, signal)).rejects.toThrow(/Insufficient credits/);
  });
});

describe("brightdata", () => {
  const env = { BRIGHTDATA_API_KEY: "bd", BRIGHTDATA_UNLOCKER_ZONE: "unlocker", BRIGHTDATA_SERP_ZONE: "serp" };

  it("unlocks and extracts locally, keeping the target status", async () => {
    const { fetch, calls } = stubFetch(() => Response.json({ status_code: 200, headers: { "Content-Type": "text/html" }, body: ARTICLE }));
    const r = await brightdataFetch.create(deps(env, fetch))!.fetch(md, signal);
    expect(calls[0].body).toEqual({ zone: "unlocker", url: md.url, format: "json" });
    expect(r.status).toBe(200);
    expect(r.content).toContain("# Hello");
  });

  it("parses SERP results, including enveloped ones", async () => {
    const serp = { organic: [{ link: "https://r", title: "R", description: "s" }] };
    for (const reply of [serp, { status_code: 200, body: JSON.stringify(serp) }]) {
      const { fetch, calls } = stubFetch(() => Response.json(reply));
      const hits = await brightdataSearch.create(deps(env, fetch))!.search({ query: "cats & dogs", limit: 5, timeoutMs: 1000 }, signal);
      expect(hits).toEqual([{ url: "https://r", title: "R", snippet: "s" }]);
      const target = new URL((calls[0].body as { url: string }).url);
      expect(target.searchParams.get("q")).toBe("cats & dogs");
      expect(target.searchParams.get("brd_json")).toBe("1");
    }
  });

  it("needs the matching zone", () => {
    const f = stubFetch(() => new Response("")).fetch;
    expect(brightdataFetch.create(deps({ BRIGHTDATA_API_KEY: "bd" }, f))).toBeNull();
    expect(brightdataSearch.create(deps({ BRIGHTDATA_API_KEY: "bd", BRIGHTDATA_UNLOCKER_ZONE: "u" }, f))).toBeNull();
  });
});
