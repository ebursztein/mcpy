import { describe, expect, it } from "vitest";
import { ErrorCode, McpyError } from "mcpy";
import { fakePages, page, testMcpy } from "../helpers.js";

describe("onServed: the host learns which provider served a call", () => {
  it("names the provider that answered, and the caller's result never does", async () => {
    const free = fakePages("free", page({ status: 403, content: "blocked" }));
    const paid = fakePages("paid", page(), 0.004);
    const heard: unknown[] = [];
    const { mcpy } = testMcpy({ pages: [free, paid] });
    const result = await mcpy.with({ onServed: (s) => heard.push(s) }).fetch({ url: "https://example.com/a" });
    expect(heard).toEqual([{ provider: "paid" }]);
    expect(JSON.stringify(result)).not.toMatch(/"paid"|"free"/);
  });

  it("is not called for a failed call", async () => {
    const heard: unknown[] = [];
    const { mcpy } = testMcpy({ pages: [fakePages("free", new McpyError(ErrorCode.UpstreamFailed, "down"))] });
    await expect(mcpy.with({ onServed: (s) => heard.push(s) }).fetch({ url: "https://example.com/b" })).rejects.toThrow();
    expect(heard).toEqual([]);
  });
});
