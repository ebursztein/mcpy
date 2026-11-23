import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_OUTPUT_CHARS, PageFormat, type ScriptRunner } from "mcpy";
import { fakePages, fakeSearch, page, testMcpy } from "../helpers.js";

const runner: ScriptRunner = async (script, p) => JSON.stringify(new Function("page", script)(p) ?? null);

describe("cached page age", () => {
  afterEach(() => vi.useRealTimers());

  it("each call reads cached pages only as old as its max_age allows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
    const direct = fakePages("direct", page());
    const { mcpy } = testMcpy({ pages: [direct], limits: { pageTtlSeconds: 86_400 } });
    const url = "https://shop.example/a";
    await mcpy.fetch({ url, max_age: 86_400 });
    vi.setSystemTime(new Date("2026-11-05T05:00:00Z"));
    expect((await mcpy.fetch({ url, max_age: 86_400 })).meta.cache).toBe("hit");
    expect((await mcpy.grep({ url, pattern: "Lorem", max_age: 86_400 })).meta.cache).toBe("hit");
    expect((await mcpy.fetch({ url })).meta.cache).toBe("miss"); // default: one hour
    expect((await mcpy.fetch({ url, max_age: 60 })).meta.cache).toBe("hit"); // the copy just fetched
    expect(direct.calls.length).toBe(2);
  });

  it("search takes the same max_age, defaulting to 15 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
    const hits = fakeSearch("s", [{ url: "https://example.com/", title: "Hit", snippet: "" }]);
    const { mcpy } = testMcpy({ search: [hits], limits: { searchTtlSeconds: 86_400 } });
    await mcpy.search({ query: "asic prices" });
    vi.setSystemTime(new Date("2026-11-05T00:20:00Z"));
    expect((await mcpy.search({ query: "asic prices", max_age: 86_400 })).meta.cache).toBe("hit");
    expect((await mcpy.search({ query: "asic prices" })).meta.cache).toBe("miss");
    expect(hits.calls).toBe(2);
  });

  it("stores the page itself, so a new script reuses it without fetching again", async () => {
    const direct = fakePages("direct", page({ content: `<h1>Miner</h1><b>42</b>${"x".repeat(MAX_OUTPUT_CHARS)}`, format: PageFormat.Html }));
    const { mcpy } = testMcpy({ pages: [direct], scripts: runner });
    const url = "https://shop.example/p";
    const a = await mcpy.fetch({ url, format: PageFormat.Html, script: "return page.content.match(/<h1>(.*?)</)[1]" });
    const b = await mcpy.fetch({ url, format: PageFormat.Html, script: "return Number(page.content.match(/<b>(.*?)</)[1])" });
    const raw = await mcpy.fetch({ url, format: PageFormat.Html });
    expect([a.content, b.content, raw.content.slice(0, 14)]).toEqual(['"Miner"', "42", "<h1>Miner</h1>"]);
    expect(direct.calls.length).toBe(1);
  });
});
