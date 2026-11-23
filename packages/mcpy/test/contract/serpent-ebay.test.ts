import { describe, expect, it } from "vitest";
import { ErrorCode } from "mcpy";
import { ListingMarket, ListingSort, ProviderId, serpentListings, SERPENT_EBAY_USD_PER_CALL, type ListingRequest } from "mcpy/providers";
import { fixtureJson, stubFetch } from "../helpers.js";
import { failureOf, json, providerCall } from "./call.js";

const KEY = "sk_live_test";
const provider = () => serpentListings({ apiKey: KEY });
const req = (over: Partial<ListingRequest> = {}): ListingRequest => ({ market: ListingMarket.EbayUs, query: "charizard", sort: ListingSort.BestMatch, page: 1, ...over });
const sent = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("serpent eBay listings contract", () => {
  it("identifies itself, bills the eBay rate and serves every eBay market", () => {
    expect(provider().id).toBe(ProviderId.Serpent);
    expect(provider().costPerCall).toBe(SERPENT_EBAY_USD_PER_CALL);
    expect(provider().markets).toContain(ListingMarket.EbayDe);
  });

  it("GETs /api/ebay/search with the market, sort, bounds and page, the key in a header", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("serpent-live-ebay.json")));
    await provider().searchListings(req({ market: ListingMarket.EbayDe, sort: ListingSort.Newest, minPrice: 49.999, maxPrice: 100.001, page: 2 }), providerCall(fetch));
    expect(calls[0].url.startsWith("https://apiserpent.com/api/ebay/search?")).toBe(true);
    expect(calls[0].headers.get("x-api-key")).toBe(KEY);
    expect(calls[0].url).not.toContain(KEY);
    // Bounds are rounded outward to cents, so no listing inside them is lost.
    expect(sent(calls[0].url)).toEqual({ q: "charizard", marketplace_id: "EBAY_DE", page: "2", sort: "newly_listed", min_price: "49.99", max_price: "100.01" });
  });

  it("reads the live rows: item id, title, price, condition, shipping, images", async () => {
    const { fetch } = stubFetch(() => json(fixtureJson("serpent-live-ebay.json")));
    const page = await provider().searchListings(req(), providerCall(fetch));
    expect(page.rows).toHaveLength(8);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBeUndefined();
    expect(page.rows[0]).toEqual({
      url: "https://www.ebay.com/itm/840111465672",
      id: "840111465672",
      title: "OVER 36+ Rare Pokemon Cards! Holo EX GX Full Art Ultra Rare Vintage Modern Mix",
      price: { amount: 11.99, currency: "USD" },
      condition: "Pre-Owned",
      shipping: "+$4.64 delivery in 2-4 days",
      seller: undefined,
      images: ["https://i.ebayimg.com/images/g/oygAAeSwHQVqNXVA/s-l500.webp"],
    });
  });

  it("drops rows without an https URL and reads a seller given by name", async () => {
    const body = { success: true, results: [{ url: "javascript:x", title: "a" }, { item_id: 123456789012, url: "https://www.ebay.com/itm/123456789012", title: "b", seller: { username: "cards4u" }, images: ["http://x/a.jpg"] }] };
    const { fetch } = stubFetch(() => json(body));
    const page = await provider().searchListings(req(), providerCall(fetch));
    expect(page.rows).toEqual([{ url: "https://www.ebay.com/itm/123456789012", id: "123456789012", title: "b", price: undefined, condition: undefined, shipping: undefined, seller: "cards4u", images: [] }]);
    expect(page.hasMore).toBe(false);
  });

  it("does not call past the API's last page", async () => {
    const { fetch, calls } = stubFetch(() => json(fixtureJson("serpent-live-ebay.json")));
    expect(await provider().searchListings(req({ page: 21 }), providerCall(fetch))).toEqual({ rows: [], hasMore: false });
    expect(calls).toHaveLength(0);
  });

  it("reports the refunded request_failed seen live as an upstream failure with its code", async () => {
    const body = { success: false, error: "Request failed", code: "request_failed", message: "We couldn't complete this request. Please try again shortly." };
    const { fetch } = stubFetch(() => json(body, 502));
    const failure = await failureOf(provider().searchListings(req(), providerCall(fetch)));
    expect(failure.code).toBe(ErrorCode.UpstreamFailed);
    expect(failure.status).toBe(502);
    expect(failure.message).toMatch(/^request_failed: /);
  });

  it("treats a success without results as a bad response", async () => {
    const { fetch } = stubFetch(() => json({ success: true }));
    expect((await failureOf(provider().searchListings(req(), providerCall(fetch)))).code).toBe(ErrorCode.BadResponse);
  });
});
