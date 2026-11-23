/** How each page provider carries POST, headers, render and wait to its backend. */

import { describe, expect, it } from "vitest";
import { ContentKind, ErrorCode, HttpMethod, PageFormat, USER_AGENTS, UserAgentProfile } from "mcpy";
import { brightData, cloudflareBrowser, cloudflareBrowserBinding, direct, firecrawl, type BrowserRenderRequest, type PageRequest } from "mcpy/providers";
import { fixtureJson, responseAt, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall, TIMEOUT_MS } from "./call.js";

const URL_IN = "https://mpapi.example.com/v2/product/42382/latestsales";
const get: PageRequest = { url: URL_IN, format: PageFormat.Markdown, userAgent: UserAgentProfile.Default };
const JSON_TYPE = { "content-type": "application/json" };

describe("direct: POST and headers", () => {
  it("sends the caller's method, body and headers, and lets the caller's User-Agent win", async () => {
    const { fetch, calls } = stubFetch(() => responseAt(URL_IN, '{"data":[]}', { headers: JSON_TYPE }));
    const body = '{"conditions":[],"limit":25}';
    const result = await direct().fetchPage(
      { ...get, method: HttpMethod.Post, body, headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 test" } },
      providerCall(fetch),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ conditions: [], limit: 25 });
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].headers.get("user-agent")).toBe("Mozilla/5.0 test");
    expect(result.content).toBe('{"data":[]}');
  });

  it("does not swap in a browser user agent after a 403 when the caller set its own", async () => {
    const { fetch, calls } = stubFetch(() => responseAt(URL_IN, "no", { status: 403, headers: { "content-type": "text/plain" } }));
    await direct().fetchPage({ ...get, headers: { "User-Agent": "mine" } }, providerCall(fetch));
    expect(calls).toHaveLength(1);
  });

  it("declares what it can send", () => {
    expect(direct().capabilities).toEqual({ post: true, headers: true });
    expect(brightData({ apiKey: "k", zone: "z" }).capabilities).toBeUndefined();
  });
});

describe("firecrawl: render wait and headers", () => {
  it("passes waitFor and the caller's headers to its browser", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("firecrawl-scrape.json")));
    await firecrawl({ apiKey: "fc" }).fetchPage({ ...get, render: true, waitMs: 4_000, headers: { Origin: "https://www.example.com" } }, providerCall(fetch));
    expect(calls[0].body).toMatchObject({ waitFor: 4_000, headers: { Origin: "https://www.example.com" } });
  });

  it("sends neither when not asked", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("firecrawl-scrape.json")));
    await firecrawl({ apiKey: "fc" }).fetchPage(get, providerCall(fetch));
    expect(calls[0].body).not.toHaveProperty("waitFor");
    expect(calls[0].body).not.toHaveProperty("headers");
  });
});

describe("cloudflare browser run (REST): render wait and headers", () => {
  it("passes waitForTimeout and setExtraHTTPHeaders", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("browser-run-markdown.json")));
    const p = cloudflareBrowser({ accountId: "acct", apiToken: "t" });
    await p.fetchPage({ ...get, render: true, waitMs: 2_500, headers: { Origin: "https://a.example" } }, providerCall(fetch));
    expect(calls[0].body).toMatchObject({ waitForTimeout: 2_500, setExtraHTTPHeaders: { Origin: "https://a.example" } });
  });
});

describe("cloudflare browser (binding)", () => {
  const html = "<html><head><title>Charizard - Base Set</title></head><body><main><h1>Charizard</h1><p>Market price $1,001.05</p></main></body></html>";

  it("hands the page to the host's browser and extracts what it rendered", async () => {
    const asked: BrowserRenderRequest[] = [];
    const p = cloudflareBrowserBinding({
      render: async (r) => {
        asked.push(r);
        return { status: 200, finalUrl: "https://www.example.com/product/42382", title: "Charizard - Base Set", html };
      },
    });
    const call = providerCall(stubFetch(() => new Response("")).fetch);
    const md = await p.fetchPage({ ...get, url: "https://www.example.com/product/42382", userAgent: UserAgentProfile.Chrome, render: true, waitMs: 3_000 }, call);
    expect(asked[0]).toMatchObject({ url: "https://www.example.com/product/42382", userAgent: USER_AGENTS[UserAgentProfile.Chrome], waitMs: 3_000, timeoutMs: TIMEOUT_MS });
    expect(md).toMatchObject({ status: 200, title: "Charizard - Base Set", kind: ContentKind.Html, format: PageFormat.Markdown });
    expect(md.content).toContain("Market price $1,001.05");
    const raw = await p.fetchPage({ ...get, format: PageFormat.Html }, call);
    expect(raw.content).toBe(html);
    // The honest default agent is not forwarded: the browser keeps its own.
    expect(asked[1].userAgent).toBeUndefined();
  });

  it("turns a browser failure into a provider failure", async () => {
    const p = cloudflareBrowserBinding({
      render: async () => {
        throw new Error("Unable to create new browser: code: 429");
      },
    });
    const failure = await failureOf(p.fetchPage(get, providerCall(stubFetch(() => new Response("")).fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(failure.message).toContain("429");
  });

  it("declares it renders", () => {
    expect(cloudflareBrowserBinding({ render: async () => ({ status: 200, finalUrl: "", html: "" }) }).capabilities).toEqual({ render: true, headers: true });
  });
});
