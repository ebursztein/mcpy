/**
 * 2026-11-23, Deepmine's daily Woyouminer read: a WooCommerce JSON API
 * (/wp-json/wc/store/v1/products) fetched fresh came back wrapped in Chrome's
 * JSON viewer page whenever the browser backend answered, so a client
 * checking that the body starts with [ or { took it for a challenge page and
 * gave up on the store. The browser providers now return a body that is not
 * HTML exactly as the server sent it. Never delete these.
 */

import { describe, expect, it } from "vitest";
import { ContentKind, PageFormat, UserAgentProfile } from "mcpy";
import { cloudflareBrowser, cloudflareBrowserBinding, type PageRequest, type RenderedPage } from "mcpy/providers";
import { unwrapBrowserViewer } from "../../src/content/viewer.js";
import { stubFetch } from "../helpers.js";
import { json, providerCall } from "../contract/call.js";
import { testMcpy } from "../helpers.js";

const URL_IN = "https://www.woyouminer.com/wp-json/wc/store/v1/products?per_page=100&page=1&_fields=id,name";
const BODY = '[{"id":25630,"name":"Bitmain Antminer Z15K <b>&</b> PSU"}]';
// What page.content() returned for it, character for character.
const WRAPPED = `<html><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"></head><body><pre>${BODY.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre><div class="json-formatter-container"></div></body></html>`;
const req: PageRequest = { url: URL_IN, format: PageFormat.Html, userAgent: UserAgentProfile.Default, render: true };
const noFetch = () => providerCall(stubFetch(() => new Response("")).fetch);
const binding = (page: Partial<RenderedPage>) => cloudflareBrowserBinding({ render: async () => ({ status: 200, finalUrl: URL_IN, html: WRAPPED, ...page }) });

describe("browser backends return JSON as the server sent it", () => {
  it("the binding returns the navigation response's body, not the rendered viewer page", async () => {
    const page = await binding({ contentType: "application/json; charset=UTF-8", body: BODY }).fetchPage(req, noFetch());
    expect(page).toMatchObject({ content: BODY, contentType: "application/json; charset=UTF-8", kind: ContentKind.Json, format: PageFormat.Html, status: 200 });
    // Markdown is not made from it either: the body is the answer.
    expect((await binding({ contentType: "application/json", body: BODY }).fetchPage({ ...req, format: PageFormat.Markdown }, noFetch())).content).toBe(BODY);
  });

  it("without the raw body, Chrome's viewer page is unwrapped", async () => {
    const page = await binding({}).fetchPage(req, noFetch());
    expect(page).toMatchObject({ content: BODY, contentType: "application/json", kind: ContentKind.Json });
    expect(JSON.parse(page.content)).toHaveLength(1);
  });

  it("Browser Run's REST API: the rendered viewer page is unwrapped too", async () => {
    const { fetch } = stubFetch(() => json({ success: true, result: WRAPPED, meta: { status: 200, finalUrl: URL_IN } }));
    const page = await cloudflareBrowser({ accountId: "a", apiToken: "t" }).fetchPage(req, providerCall(fetch));
    expect(page).toMatchObject({ content: BODY, kind: ContentKind.Json });
  });

  it("an HTML page is still read as rendered, and only Chrome's exact viewer is unwrapped", async () => {
    const html = "<html><head><title>Shop</title></head><body><pre>[1]</pre><p>more</p></body></html>";
    const page = await binding({ html, contentType: "text/html; charset=utf-8", body: "ignored" }).fetchPage(req, noFetch());
    expect(page).toMatchObject({ content: html, kind: ContentKind.Html, contentType: "text/html" });
    expect(unwrapBrowserViewer(html)).toBeUndefined();
    expect(unwrapBrowserViewer('<html><head><meta name="color-scheme" content="light dark"></head><body><pre style="word-wrap: break-word; white-space: pre-wrap;">a &amp;lt; b</pre></body></html>')).toEqual({ body: "a &lt; b", contentType: "text/plain" });
  });

  it("a fetch through the browser hands the caller the raw JSON", async () => {
    const browser = binding({ contentType: "application/json", body: BODY });
    const { mcpy } = testMcpy({ pages: [browser] });
    const r = await mcpy.fetch({ url: URL_IN, format: "html", render: true, max_age: 0 });
    expect(r.content.startsWith("[")).toBe(true);
    expect(JSON.parse(r.content)[0].id).toBe(25630);
  });
});
