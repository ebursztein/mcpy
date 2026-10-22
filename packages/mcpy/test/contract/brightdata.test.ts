import { describe, expect, it } from "vitest";
import { ErrorCode, PageFormat, UserAgentProfile } from "mcpy";
import { brightData, brightDataSearch, ProviderId } from "mcpy/providers";
import { fixture, fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall } from "./call.js";

const KEY = "bd-test-key";
const API = "https://api.brightdata.com/request";
const TARGET = "https://example.com/blog/circuit-breakers";
const unlocker = () => brightData({ apiKey: KEY, zone: "web_unlocker1" });
const serp = () => brightDataSearch({ apiKey: KEY, zone: "serp_api1" });
const req = (format: PageFormat = PageFormat.Markdown) => ({ url: TARGET, format, userAgent: UserAgentProfile.ChromeDesktop });
type Envelope = { status_code: number; headers: Record<string, string>; body: string };

describe("bright data web unlocker contract", () => {
  it("identifies itself", () => {
    expect(unlocker().id).toBe(ProviderId.BrightData);
    expect(serp().id).toBe(ProviderId.BrightData);
  });

  it("POSTs {zone, url, format: json} with Bearer auth and no headers or user agent", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("brightdata-unlocker.json")));
    await unlocker().fetchPage(req(), providerCall(fetch));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(API);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(calls[0].headers.get("user-agent")).toBeNull();
    expect(calls[0].body).toEqual({ zone: "web_unlocker1", url: TARGET, format: "json" });
    expect(calls[0].body).not.toHaveProperty("headers");
  });

  it("extracts the HTML body to markdown with the target status and content type", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("brightdata-unlocker.json")));
    const page = await unlocker().fetchPage(req(), providerCall(fetch));
    expect(page).toMatchObject({ url: TARGET, finalUrl: TARGET, status: 200, contentType: "text/html; charset=utf-8", format: PageFormat.Markdown });
    expect(page.title).toContain("Understanding Circuit Breakers");
    expect(page.content).toContain("## Choosing thresholds");
    expect(page.content).not.toContain("<article>");
  });

  it("returns the HTML body as-is in HTML mode", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("brightdata-unlocker.json")));
    const page = await unlocker().fetchPage(req(PageFormat.Html), providerCall(fetch));
    expect(page.content).toBe(fixture("article.html"));
    expect(page.title).toBe("Understanding Circuit Breakers | Example Engineering Blog");
    expect(page.format).toBe(PageFormat.Html);
  });

  it("passes non-HTML bodies through and reports the target's own status", async () => {
    const envelope: Envelope = { status_code: 404, headers: { "Content-Type": "text/plain" }, body: "no such page" };
    const { fetch } = stubFetch(() => json(envelope));
    const page = await unlocker().fetchPage(req(), providerCall(fetch));
    expect(page).toMatchObject({ status: 404, contentType: "text/plain", content: "no such page" });
  });

  it("defaults a bare envelope to status 0, text/html and empty content", async () => {
    const { fetch } = stubFetch(() => json({}));
    const page = await unlocker().fetchPage(req(PageFormat.Html), providerCall(fetch));
    expect(page).toMatchObject({ status: 0, contentType: "text/html", content: "" });
  });

  it("doubles the byte cap for the JSON envelope", async () => {
    const big = { status_code: 200, headers: { "content-type": "text/plain" }, body: "x".repeat(1_500_000) };
    const { fetch } = stubFetch(() => json(big));
    const page = await unlocker().fetchPage(req(), providerCall(fetch));
    expect(page.content).toHaveLength(1_500_000);
  });

  it.each([
    [401, "Unauthorized"],
    [402, "Insufficient balance"],
    [502, "proxy error"],
  ])("maps HTTP %i to upstream_failed with the status", async (status, text) => {
    const { fetch } = stubFetch(() => new Response(text, { status }));
    const failure = await failureOf(unlocker().fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(failure.status).toBe(status);
    expect(failure.message).toBe(`HTTP ${status}: ${text}`);
  });

  it.each([
    ["non-JSON", "<html>raw page despite format json</html>"],
    ["wrong shape", { status_code: "200", body: 7 }],
  ])("maps a %s envelope to bad_response", async (_name, body) => {
    const { fetch } = stubFetch(() => json(body));
    const failure = await failureOf(unlocker().fetchPage(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.BadResponse);
  });
});

describe("bright data SERP contract", () => {
  const expected = [
    {
      url: "https://martinfowler.com/bliki/CircuitBreaker.html",
      title: "CircuitBreaker",
      snippet: "It is common for software systems to make remote calls to software running in different processes.",
    },
    {
      url: "https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker",
      title: "Circuit Breaker pattern - Azure Architecture Center",
      snippet: "Handle faults that might take a variable amount of time to fix when connecting to a remote service.",
    },
    { url: "https://example.com/blog/circuit-breakers", title: "https://example.com/blog/circuit-breakers", snippet: "" },
  ];

  it("POSTs a Google URL with q, num and brd_json=1 in raw format", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("brightdata-serp.json")));
    await serp().search({ query: "circuit breaker pattern", limit: 10 }, providerCall(fetch));
    expect(calls[0].url).toBe(API);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    const body = calls[0].body as { zone: string; url: string; format: string };
    expect(body).toMatchObject({ zone: "serp_api1", format: "raw" });
    expect(body).not.toHaveProperty("headers");
    const google = new URL(body.url);
    expect(`${google.origin}${google.pathname}`).toBe("https://www.google.com/search");
    expect(Object.fromEntries(google.searchParams)).toEqual({ q: "circuit breaker pattern", num: "10", brd_json: "1" });
  });

  it("caps num at 100", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("brightdata-serp.json")));
    await serp().search({ query: "x", limit: 500 }, providerCall(fetch));
    expect(new URL((calls[0].body as { url: string }).url).searchParams.get("num")).toBe("100");
  });

  it("maps organic results, defaulting title to the link and snippet to empty", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("brightdata-serp.json")));
    expect(await serp().search({ query: "circuit breaker pattern", limit: 10 }, providerCall(fetch))).toEqual(expected);
  });

  it("unwraps a SERP delivered inside the unlocker envelope", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("brightdata-serp-wrapped.json")));
    expect(await serp().search({ query: "circuit breaker pattern", limit: 10 }, providerCall(fetch))).toEqual(expected);
  });

  it("honors the limit", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("brightdata-serp.json")));
    expect(await serp().search({ query: "x", limit: 1 }, providerCall(fetch))).toEqual(expected.slice(0, 1));
  });

  it("maps an HTML SERP (brd_json not enabled) to bad_response", async () => {
    const { fetch } = stubFetch(() => new Response("<!doctype html><title>Google</title>", { status: 200 }));
    const failure = await failureOf(serp().search({ query: "x", limit: 5 }, providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.BadResponse);
    expect(failure.message).toContain("brd_json");
  });

  it("maps a wrapped body that is not JSON to bad_response", async () => {
    const { fetch } = stubFetch(() => json({ status_code: 200, body: "<html>captcha</html>" }));
    const failure = await failureOf(serp().search({ query: "x", limit: 5 }, providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.BadResponse);
  });

  it("maps HTTP errors to upstream_failed with the status", async () => {
    const { fetch } = stubFetch(() => new Response("zone not found", { status: 400 }));
    const failure = await failureOf(serp().search({ query: "x", limit: 5 }, providerCall(fetch)));
    expect([failure.code, failure.status]).toEqual([ErrorCode.UpstreamFailed, 400]);
  });
});
