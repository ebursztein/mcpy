import { describe, expect, it } from "vitest";
import { ErrorCode, MAX_OUTPUT_CHARS, McpyError, PageFormat, type ScriptRunner } from "mcpy";
import { renderFetch } from "mcpy/mcp";
import { fakePages, page, testMcpy } from "../helpers.js";

const BIG = page({ content: `<h1>Miner</h1>${"x".repeat(MAX_OUTPUT_CHARS * 3)}`, format: PageFormat.Html });

/** Stands in for the server's Worker Loader: the script is a function body over `page`. */
const runner: ScriptRunner = async (script, p) => JSON.stringify(new Function("page", script)(p) ?? null);

describe("fetch script", () => {
  it("returns only what the script returns, from the whole page", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", BIG)], scripts: runner });
    const r = await mcpy.fetch({ url: "https://example.com/a", format: PageFormat.Html, script: "return { title: page.content.match(/<h1>(.*?)<\\/h1>/)[1], size: page.content.length }" });
    expect(JSON.parse(r.content)).toEqual({ title: "Miner", size: BIG.content.length });
    expect(r.next_offset).toBeUndefined();
    expect(r.tip).toBeUndefined();
  });

  it("pages a script result that is too long, like any content", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", BIG)], scripts: runner });
    const r = await mcpy.fetch({ url: "https://example.com/a", script: "return page.content", max_chars: 1_000 });
    expect(r.content.length).toBe(1_000);
    expect(r.next_offset).toBe(1_000);
  });

  it("suggests a script when a page is too long for one call", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", BIG)] });
    const r = await mcpy.fetch({ url: "https://example.com/a" });
    expect(r.tip).toContain("script");
    expect(renderFetch(r)).toContain("Tip: ");
    const { mcpy: small } = testMcpy({ pages: [fakePages("direct", page())] });
    expect((await small.fetch({ url: "https://example.com/a" })).tip).toBeUndefined();
  });

  it("reports a failing script as the caller's error", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", BIG)], scripts: runner });
    const err = await mcpy.fetch({ url: "https://example.com/a", script: "throw new Error('no price')" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpyError);
    expect((err as McpyError).code).toBe(ErrorCode.InvalidInput);
    expect((err as McpyError).message).toBe("script failed: no price");
  });

  it("rejects a script when the host runs none", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("direct", BIG)] });
    const err = await mcpy.fetch({ url: "https://example.com/a", script: "return 1" }).catch((e: unknown) => e);
    expect((err as McpyError).code).toBe(ErrorCode.NoProviders);
  });
});
