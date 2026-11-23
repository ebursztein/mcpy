import { describe, expect, it } from "vitest";
import { ContentKind, PageFormat } from "mcpy";
import { SpendMeter } from "../../src/engine/meter.js";
import { fakePages, page, testMcpy } from "../helpers.js";
import { fixture } from "../shopping/site-harness.js";

const html = (content: string, url: string) => page({ url, finalUrl: url, content, contentType: "text/html", kind: ContentKind.Html, format: PageFormat.Html });

describe("what a call cost", () => {
  it("a part meter asks the operation's limit once and adds to its total", async () => {
    let asked = 0;
    const meter = new SpendMeter({ allows: async () => (asked++, true), record: async () => undefined });
    const a = meter.part();
    const b = meter.part();
    a.spend(0.002);
    b.spend(0.001);
    expect(await a.mayPay()).toBe(true);
    expect(await b.mayPay()).toBe(true);
    expect(asked).toBe(1);
    expect([a.spentUsd, b.spentUsd, meter.spentUsd]).toEqual([0.002, 0.001, 0.003]);
  });

  it("states the call's cost in meta and each store's in its report; a cached repeat costs 0", async () => {
    const lbc = fixture("europe-a/leboncoin.html");
    const paid = fakePages("paid", (req) => html(lbc, req.url), 0.004);
    const { mcpy } = testMcpy({ pages: [paid] });
    const input = { marketplaces: ["leboncoin"] as const, query: "pokemon" };
    const first = await mcpy.shopping({ ...input, marketplaces: [...input.marketplaces] });
    expect(first.meta.cost_usd).toBe(0.004);
    expect(first.marketplaces[0]!.cost_usd).toBe(0.004);
    const again = await mcpy.shopping({ ...input, marketplaces: [...input.marketplaces] });
    expect(again.meta.cost_usd).toBe(0);
    expect(again.marketplaces[0]!.cost_usd).toBe(0);
  });

  it("states it on every tool's result", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("free", (req) => html("<html><body><p>hello</p></body></html>", req.url))] });
    expect((await mcpy.fetch({ url: "https://example.com/" })).meta.cost_usd).toBe(0);
  });
});
