import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export interface Extracted {
  title?: string;
  markdown: string;
}

type ReadabilityDoc = ConstructorParameters<typeof Readability>[0];
type TurndownInput = Parameters<TurndownService["turndown"]>[0];

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.remove(["script", "style", "noscript", "iframe"]);

/**
 * HTML -> readable markdown. Readability isolates the main content; when it
 * finds nothing we fall back to the whole body so the caller still gets text.
 */
export function htmlToMarkdown(html: string, url: string): Extracted {
  const { document } = parseHTML(html);
  const pageTitle = document.title?.trim() || undefined;

  let article: ReturnType<Readability["parse"]> = null;
  try {
    article = new Readability(document.cloneNode(true) as unknown as ReadabilityDoc, { keepClasses: false }).parse();
  } catch {
    article = null;
  }

  const source = article?.content ? parseHTML(`<html><body>${article.content}</body></html>`).document.body : document.body;
  if (source) absolutizeLinks(source, url);
  const markdown = source ? turndown.turndown(source as unknown as TurndownInput).trim() : "";

  return {
    title: article?.title?.trim() || pageTitle,
    markdown: markdown || (document.body?.textContent ?? "").trim(),
  };
}

/** Rewrite relative href/src to absolute so links in the markdown stay usable. */
function absolutizeLinks(root: { querySelectorAll(sel: string): Iterable<unknown> }, base: string): void {
  for (const node of root.querySelectorAll("a[href], img[src]")) {
    const el = node as { getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; tagName: string };
    const attr = el.tagName.toLowerCase() === "a" ? "href" : "src";
    const value = el.getAttribute(attr);
    if (!value || value.startsWith("#") || /^(data|javascript|mailto):/i.test(value)) continue;
    try {
      el.setAttribute(attr, new URL(value, base).toString());
    } catch {
      // leave malformed URLs untouched
    }
  }
}

/** Title of an HTML page without full extraction. */
export function htmlTitle(html: string): string | undefined {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m?.[1]?.trim() || undefined;
}

/**
 * Split YAML frontmatter that markdown sources (Browser Run, sites serving
 * text/markdown to agents) prepend, returning its title and the body.
 */
export function splitFrontmatter(md: string): { title?: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { body: md };
  const title = /^title:\s*["']?(.*?)["']?\s*$/m.exec(m[1])?.[1];
  return { title: title || undefined, body: md.slice(m[0].length).trimStart() };
}
