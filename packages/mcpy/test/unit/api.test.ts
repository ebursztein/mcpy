import { describe, expect, it } from "vitest";
import {
  CacheStatus,
  ErrorCode,
  FetchResultSchema,
  GrepResultSchema,
  LogLevel,
  MAX_GREP_OUTPUT_CHARS,
  MAX_OUTPUT_CHARS,
  MAX_SNIPPET_CHARS,
  McpyError,
  Operation,
  PageFormat,
  SearchResultSchema,
  SpanName,
  SpanStatus,
  Transport,
} from "mcpy";
import { Attr } from "mcpy/telemetry";
import { fakePages, fakeSearch, LONG_TEXT, mentionsProvider, page, testMcpy } from "../helpers.js";

const URL_A = "https://example.com/a";

async function mcpyError(p: Promise<unknown>): Promise<McpyError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(McpyError);
  return err as McpyError;
}

describe("result shapes", () => {
  const pages = fakePages("direct", page({ title: "Doc", content: `intro\nneedle here\n${LONG_TEXT}` }));
  const search = fakeSearch("firecrawl", [{ url: "https://a.example/", title: "A", snippet: "about a" }]);
  const { mcpy } = testMcpy({ pages: [pages], search: [search] });

  it("fetch returns a FetchResult with no provider in it", async () => {
    const result = await mcpy.fetch({ url: URL_A });
    expect(FetchResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ url: URL_A, final_url: URL_A, title: "Doc", status: 200, format: PageFormat.Markdown });
    expect(mentionsProvider(result)).toBe(false);
  });

  it("grep returns a GrepResult with no provider in it", async () => {
    const result = await mcpy.grep({ url: URL_A, pattern: "NEEDLE", context_lines: 0 });
    expect(GrepResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ matches: 1, capped: false, total_lines: 3, output: "> 2: needle here", truncated: false });
    expect(mentionsProvider(result)).toBe(false);
  });

  it("search returns a SearchResult with no provider in it", async () => {
    const result = await mcpy.search({ query: "  cats  " });
    expect(SearchResultSchema.parse(result)).toEqual(result);
    expect(result.query).toBe("cats");
    expect(result.results).toEqual([{ url: "https://a.example/", title: "A", snippet: "about a" }]);
    expect(mentionsProvider(result)).toBe(false);
  });

  it("errors carry no provider either", async () => {
    const { mcpy: failing } = testMcpy({ pages: [fakePages("direct", new Error("direct: connection refused"))] });
    const err = await mcpyError(failing.fetch({ url: URL_A }));
    expect(mentionsProvider(err.toJSON())).toBe(false);
  });
});

describe("fetch pagination", () => {
  const content = "0123456789".repeat(25); // 250 chars
  const { mcpy } = testMcpy({ pages: [fakePages("p", page({ content }))] });

  it("returns the first window with a next_index", async () => {
    const r = await mcpy.fetch({ url: URL_A, max_length: 100 });
    expect(r).toMatchObject({ start_index: 0, end_index: 100, total_length: 250, next_index: 100, truncated: true });
    expect(r.content).toBe(content.slice(0, 100));
  });

  it("follows next_index to the last window, which has none", async () => {
    const mid = await mcpy.fetch({ url: URL_A, max_length: 100, start_index: 100 });
    expect(mid).toMatchObject({ end_index: 200, next_index: 200, truncated: true });
    const last = await mcpy.fetch({ url: URL_A, max_length: 100, start_index: mid.next_index });
    expect(last).toMatchObject({ start_index: 200, end_index: 250, truncated: false });
    expect(last.next_index).toBeUndefined();
    expect(last.content).toBe(content.slice(200));
  });

  it("returns an empty window past the end", async () => {
    const r = await mcpy.fetch({ url: URL_A, start_index: 1_000 });
    expect(r).toMatchObject({ content: "", truncated: false, total_length: 250 });
  });

  it.each([MAX_OUTPUT_CHARS + 1, 99, 1.5])("rejects max_length %s as invalid_input with details", async (max_length) => {
    const err = await mcpyError(mcpy.fetch({ url: URL_A, max_length }));
    expect(err.code).toBe(ErrorCode.InvalidInput);
    expect(err.httpStatus).toBe(400);
    expect(err.details?.some((d) => d.startsWith("max_length"))).toBe(true);
  });

  it("rejects a malformed input object as invalid_input", async () => {
    const err = await mcpyError(mcpy.fetch({ url: "not a url" }));
    expect(err.code).toBe(ErrorCode.InvalidInput);
    expect(err.details?.some((d) => d.startsWith("url"))).toBe(true);
  });
});

describe("target validation", () => {
  it.each([
    "http://127.0.0.1/admin",
    "http://localhost:8080/",
    "http://api.localhost/",
    "http://printer.local/",
    "http://metadata.internal/",
    "http://10.1.2.3/",
    "http://192.168.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/",
    "http://0x7f000001/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "https://user:pass@example.com/",
    "https://user@example.com/",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])("refuses %s as invalid_target without calling a provider", async (url) => {
    const p = fakePages("p", page());
    const { mcpy } = testMcpy({ pages: [p] });
    for (const call of [mcpy.fetch({ url }), mcpy.grep({ url, pattern: "x" })]) {
      expect((await mcpyError(call)).code).toBe(ErrorCode.InvalidTarget);
    }
    expect(p.calls).toHaveLength(0);
  });

  it.each(["http://172.15.0.1/", "http://172.32.0.1/", "https://example.com/"])("accepts the public host %s", async (url) => {
    const { mcpy } = testMcpy({ pages: [fakePages("p", page())] });
    await expect(mcpy.fetch({ url })).resolves.toMatchObject({ status: 200 });
  });

  // Regression: equivalent spellings of loopback used to slip past the guard
  // (trailing-dot FQDN, IPv4-mapped IPv6, unspecified address).
  it.each(["http://localhost./", "http://[::ffff:127.0.0.1]/", "http://[::]/"])("refuses the loopback alias %s", async (url) => {
    const p = fakePages("p", page());
    const { mcpy } = testMcpy({ pages: [p] });
    expect((await mcpyError(mcpy.fetch({ url }))).code).toBe(ErrorCode.InvalidTarget);
  });
});

describe("grep limits", () => {
  it("caps output at MAX_GREP_OUTPUT_CHARS and flags it", async () => {
    const content = Array.from({ length: 300 }, (_, i) => `match ${i} ${"x".repeat(200)}`).join("\n");
    const { mcpy } = testMcpy({ pages: [fakePages("p", page({ content }))] });
    const r = await mcpy.grep({ url: URL_A, pattern: "^match", context_lines: 0, max_matches: 200 });
    expect(r).toMatchObject({ matches: 200, capped: true, total_lines: 300, truncated: true });
    expect(r.output.length).toBeLessThanOrEqual(MAX_GREP_OUTPUT_CHARS);
    expect(r.output.endsWith("…")).toBe(true);
  });

  it("rejects an overlong pattern as invalid_input", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("p", page())] });
    expect((await mcpyError(mcpy.grep({ url: URL_A, pattern: "a".repeat(501) }))).code).toBe(ErrorCode.InvalidInput);
  });

  // Regression: an invalid regex used to surface as `internal` (HTTP 500).
  it("rejects an invalid regex as invalid_input", async () => {
    const { mcpy } = testMcpy({ pages: [fakePages("p", page())] });
    expect((await mcpyError(mcpy.grep({ url: URL_A, pattern: "(unclosed" }))).code).toBe(ErrorCode.InvalidInput);
  });
});

describe("search snippets", () => {
  it("collapses whitespace and clips titles and snippets to MAX_SNIPPET_CHARS", async () => {
    const hits = [
      { url: "https://a.example/", title: "  Spaced title \n", snippet: "  line one\n\n\tline   two  " },
      { url: "https://b.example/", title: "T".repeat(1_000), snippet: `# Heading\n\n${"word ".repeat(500)}` },
    ];
    const { mcpy } = testMcpy({ search: [fakeSearch("s", hits)] });
    const [a, b] = (await mcpy.search({ query: "q" })).results;
    expect(a).toMatchObject({ title: "Spaced title", snippet: "line one line two" });
    expect(b.title.length).toBe(MAX_SNIPPET_CHARS);
    expect(b.snippet.length).toBe(MAX_SNIPPET_CHARS);
    expect(b.snippet).not.toMatch(/\s\s|\n/);
    expect(b.snippet.endsWith("…")).toBe(true);
  });
});

describe("telemetry", () => {
  it("tags the operation span, its attempt spans and the log with client and request id", async () => {
    const { mcpy, sink } = testMcpy({ pages: [fakePages("blocked", page({ status: 403 })), fakePages("good", page())] });
    await mcpy.with({ client: "alice", requestId: "r1" }).fetch({ url: URL_A });

    const op = sink.spans.find((s) => s.name === SpanName.Operation)!;
    expect(op.status).toBe(SpanStatus.Ok);
    expect(op.attributes).toMatchObject({
      [Attr.ClientName]: "alice",
      [Attr.RequestId]: "r1",
      [Attr.Operation]: Operation.Fetch,
      [Attr.Transport]: Transport.Sdk,
      [Attr.Cache]: CacheStatus.Miss,
      [Attr.Attempts]: 2,
      [Attr.Provider]: "good",
    });

    const attempts = sink.spans.filter((s) => s.name === SpanName.Attempt);
    expect(attempts).toHaveLength(2);
    for (const s of attempts) {
      expect(s).toMatchObject({ traceId: op.traceId, parentSpanId: op.spanId });
      expect(s.attributes).toMatchObject({ [Attr.ClientName]: "alice", [Attr.RequestId]: "r1" });
    }

    const info = sink.logs.find((l) => l.level === LogLevel.Info)!;
    expect(info).toMatchObject({ traceId: op.traceId, spanId: op.spanId, message: `${Operation.Fetch} ok` });
    expect(info.attributes).toMatchObject({ [Attr.ClientName]: "alice", [Attr.RequestId]: "r1", [Attr.Cache]: CacheStatus.Miss });
  });

  it("parents the operation span on a caller's trace context", async () => {
    const { mcpy, sink } = testMcpy({ pages: [fakePages("p", page())] });
    const parent = { traceId: "c".repeat(32), spanId: "d".repeat(16) };
    await mcpy.with({ parent, transport: Transport.Rest }).fetch({ url: URL_A });
    const op = sink.spans.find((s) => s.name === SpanName.Operation)!;
    expect(op).toMatchObject({ traceId: parent.traceId, parentSpanId: parent.spanId, attributes: { [Attr.Transport]: Transport.Rest } });
  });

  it("marks an upstream failure with an error span and an error log naming the code", async () => {
    const { mcpy, sink } = testMcpy({ pages: [fakePages("p", new Error("boom"))] });
    await mcpyError(mcpy.with({ client: "bob" }).fetch({ url: URL_A }));
    const op = sink.spans.find((s) => s.name === SpanName.Operation)!;
    expect(op.status).toBe(SpanStatus.Error);
    expect(op.attributes[Attr.ErrorType]).toBe(ErrorCode.UpstreamFailed);
    const log = sink.logs.find((l) => l.level === LogLevel.Error)!;
    expect(log.attributes).toMatchObject({ [Attr.ErrorType]: ErrorCode.UpstreamFailed, [Attr.ClientName]: "bob" });
    expect(log.spanId).toBe(op.spanId);
  });

  it("logs a caller error at warn level with its code", async () => {
    const { mcpy, sink } = testMcpy({ pages: [fakePages("p", page())] });
    await mcpyError(mcpy.fetch({ url: "http://127.0.0.1/" }));
    const op = sink.spans.find((s) => s.name === SpanName.Operation)!;
    expect(op.status).toBe(SpanStatus.Error);
    expect(op.attributes[Attr.ErrorType]).toBe(ErrorCode.InvalidTarget);
    const log = sink.logs.find((l) => l.level === LogLevel.Warn)!;
    expect(log.attributes[Attr.ErrorType]).toBe(ErrorCode.InvalidTarget);
    expect(sink.logs.some((l) => l.level === LogLevel.Error)).toBe(false);
  });
});
