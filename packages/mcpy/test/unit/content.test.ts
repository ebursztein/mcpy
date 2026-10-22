/**
 * Content helpers. Extraction assertions stick to durable behavior (what is
 * kept, dropped and resolved), not the exact markdown an engine produces.
 */

import { describe, expect, it } from "vitest";
import { htmlTitle, htmlToMarkdown, splitFrontmatter } from "../../src/content/extract.js";
import { clip, grepLines, paginate } from "../../src/content/text.js";

const PARA = "The quick brown fox jumps over the lazy dog near the riverbank today. ".repeat(30);

function articlePage(extra = ""): string {
  return `<!doctype html><html><head><title>My &amp; Page</title><style>.SECRET_STYLE{color:red}</style></head><body>
    <nav><a href="/home">NAVLINK Home</a> <a href="/about">NAVLINK About</a></nav>
    <main><article><h1>Article Heading</h1><p>${PARA}</p>
      <p><a href="/next">next page</a> <img src="/img/pic.png" alt="pic"> <a href="#top">top</a>
      <a href="mailto:me@example.com">mail</a> <a href="https://other.example/x">abs</a></p>${extra}</article></main>
    <script>var SECRET_SCRIPT = 1;</script><noscript>SECRET_NOSCRIPT</noscript><footer>FOOTERTEXT</footer></body></html>`;
}

describe("htmlToMarkdown", () => {
  const { title, markdown } = htmlToMarkdown(articlePage(), "https://example.com/blog/post");

  it("takes the title from <title>, entity-decoded", () => {
    expect(title).toBe("My & Page");
  });

  it("keeps the main article text", () => {
    expect(markdown).toContain("Article Heading");
    expect(markdown).toContain("The quick brown fox jumps over the lazy dog");
  });

  it("drops script, style, noscript and navigation content", () => {
    expect(markdown).not.toContain("SECRET_SCRIPT");
    expect(markdown).not.toContain("SECRET_STYLE");
    expect(markdown).not.toContain("SECRET_NOSCRIPT");
    expect(markdown).not.toContain("NAVLINK");
  });

  it("makes root-relative links and images absolute", () => {
    expect(markdown).toContain("https://example.com/next");
    expect(markdown).toContain("https://example.com/img/pic.png");
    expect(markdown).not.toMatch(/\]\(\/(next|img)/);
  });

  it("leaves absolute and mailto links usable", () => {
    expect(markdown).toContain("https://other.example/x");
    expect(markdown).toContain("mailto:me@example.com");
  });

  // Regression: links used to resolve against the origin only (fixed by
  // passing the full page URL to mdream).
  it("resolves path-relative links against the page URL, not just its origin", () => {
    const html = articlePage(`<p><a href="sibling">sib</a> <img src="img/rel.png" alt="r"> <a href="../up">up</a></p>`);
    const md = htmlToMarkdown(html, "https://example.com/blog/post").markdown;
    expect(md).toContain("https://example.com/blog/sibling");
    expect(md).toContain("https://example.com/blog/img/rel.png");
    expect(md).toContain("https://example.com/up");
  });

  it("falls back to the whole page when main-content isolation would drop most of it", () => {
    const html = `<html><head><title>Side</title></head><body><aside><p>${PARA}</p></aside><main><p>short main</p></main></body></html>`;
    const md = htmlToMarkdown(html, "https://example.com/").markdown;
    expect(md).toContain("The quick brown fox");
    expect(md).toContain("short main");
  });

  it("handles small pages, empty input and pages without a title", () => {
    expect(htmlToMarkdown("<p>tiny page</p><script>S()</script>", "https://example.com/").markdown).toContain("tiny page");
    expect(htmlToMarkdown("<p>tiny page</p><script>S()</script>", "https://example.com/").markdown).not.toContain("S()");
    const empty = htmlToMarkdown("", "https://example.com/");
    expect(empty.markdown).toBe("");
    expect(empty.title).toBeUndefined();
    expect(() => htmlToMarkdown("<div><p>unclosed", "not a url")).not.toThrow();
  });
});

describe("htmlTitle", () => {
  it("reads, decodes and trims the title", () => {
    expect(htmlTitle(`<title lang="en">\n  A &lt;b&gt; &quot;c&quot;  </title>`)).toBe(`A <b> "c"`);
    expect(htmlTitle("<TITLE>Upper</TITLE>")).toBe("Upper");
  });

  it("is undefined when missing or blank", () => {
    expect(htmlTitle("<html></html>")).toBeUndefined();
    expect(htmlTitle("<title>   </title>")).toBeUndefined();
  });
});

describe("splitFrontmatter", () => {
  it("reads an unquoted title and strips the block", () => {
    expect(splitFrontmatter("---\ntitle: Cloudflare Blog\nauthor: x\n---\n\n# Posts")).toEqual({ title: "Cloudflare Blog", body: "# Posts" });
  });

  it.each([`"Quoted: Title"`, `'Quoted: Title'`])("reads a quoted title %s", (raw) => {
    expect(splitFrontmatter(`---\ntitle: ${raw}\n---\nbody`).title).toBe("Quoted: Title");
  });

  it("handles CRLF line endings", () => {
    expect(splitFrontmatter("---\r\ndescription: d\r\ntitle: Windows\r\n---\r\nBody\r\n")).toEqual({ title: "Windows", body: "Body\r\n" });
  });

  it("returns the body untouched when there is no frontmatter", () => {
    const md = "# Heading\n\n---\n\ntext";
    expect(splitFrontmatter(md)).toEqual({ body: md });
  });

  it("strips frontmatter without a title", () => {
    expect(splitFrontmatter("---\nlang: en\n---\nbody")).toEqual({ title: undefined, body: "body" });
  });

  it("does not take a title from the body", () => {
    expect(splitFrontmatter("---\nlang: en\n---\ntitle: not me")).toEqual({ title: undefined, body: "title: not me" });
  });
});

describe("paginate", () => {
  const text = "abcdefghij";

  it("returns a window and whether more follows", () => {
    expect(paginate(text, 0, 4)).toEqual({ chunk: "abcd", total: 10, end: 4, hasMore: true });
    expect(paginate(text, 4, 4)).toEqual({ chunk: "efgh", total: 10, end: 8, hasMore: true });
    expect(paginate(text, 8, 4)).toEqual({ chunk: "ij", total: 10, end: 10, hasMore: false });
  });

  it("is empty past the end and whole when the window covers everything", () => {
    expect(paginate(text, 20, 4)).toEqual({ chunk: "", total: 10, end: 20, hasMore: false });
    expect(paginate(text, 0, 100)).toEqual({ chunk: text, total: 10, end: 10, hasMore: false });
    expect(paginate("", 0, 5)).toEqual({ chunk: "", total: 0, end: 0, hasMore: false });
  });
});

describe("grepLines", () => {
  const lines = ["zero", "one HIT", "two", "three HIT", "four", "five", "six", "seven", "eight HIT", "nine"];

  it("marks matches, numbers lines from 1 and is case-insensitive", () => {
    const r = grepLines(lines, "hit", 0, 10);
    expect(r).toEqual({ output: "> 2: one HIT\n--\n> 4: three HIT\n--\n> 9: eight HIT", matches: 3, capped: false });
  });

  it("merges overlapping and adjacent context windows into one block", () => {
    const r = grepLines(lines, "hit", 1, 10);
    const blocks = r.output.split("\n--\n");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].split("\n")).toEqual(["  1: zero", "> 2: one HIT", "  3: two", "> 4: three HIT", "  5: four"]);
    expect(blocks[1].split("\n")).toEqual(["  8: seven", "> 9: eight HIT", "  10: nine"]);
    expect(grepLines(["a", "x", "b", "c", "x"], "x", 1, 10).output).not.toContain("--");
  });

  it("clamps context at the start and end of the document", () => {
    expect(grepLines(["HIT", "b"], "hit", 5, 10).output).toBe("> 1: HIT\n  2: b");
  });

  it("caps matches and reports it only when more exist", () => {
    expect(grepLines(lines, "hit", 0, 2)).toMatchObject({ matches: 2, capped: true });
    expect(grepLines(lines, "hit", 0, 3)).toMatchObject({ matches: 3, capped: false });
  });

  it("returns nothing for no match", () => {
    expect(grepLines(lines, "absent", 2, 10)).toEqual({ output: "", matches: 0, capped: false });
  });

  it("rejects an invalid regex", () => {
    expect(() => grepLines(lines, "(unclosed", 0, 10)).toThrow(/invalid regex/);
  });

  it("rejects an overlong pattern", () => {
    expect(() => grepLines(lines, "a".repeat(501), 0, 10)).toThrow(/pattern longer than 500/);
    expect(() => grepLines(lines, "a".repeat(500), 0, 10)).not.toThrow();
  });

  it("only tests the head of very long lines", () => {
    const long = `${"x".repeat(6_000)}NEEDLE`;
    expect(grepLines([long], "needle", 0, 10).matches).toBe(0);
  });
});

describe("clip", () => {
  it("leaves short text alone and marks a cut with an ellipsis", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("exactly10!", 10)).toBe("exactly10!");
    expect(clip("this is too long", 10)).toBe("this is t…");
    expect(clip("this is too long", 10)).toHaveLength(10);
  });
});
