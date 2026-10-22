/**
 * HTML -> markdown for LLMs, via mdream (Rust/WASM, ~100x faster than
 * DOM-based converters, with a dedicated workerd build).
 *
 * Main-content isolation: mdream's `minimal` mode drops nav, footers, forms
 * and asides. It occasionally drops nearly everything (table layouts such as
 * Hacker News); then the full page is converted and the larger result wins.
 * Too much text beats silently missing content.
 */

import { htmlToMarkdown as mdream } from "mdream";

export interface Extracted {
  title?: string;
  markdown: string;
}

/**
 * When `minimal` keeps at least this many words it is trusted as is (one
 * conversion). Below it, the full page is converted too and the larger wins:
 * table layouts like Hacker News lose almost everything in `minimal`.
 */
export const MIN_MAIN_WORDS = 200;

function wordCount(text: string): number {
  return text.match(/\w+/g)?.length ?? 0;
}

/** The page URL as link base; mdream resolves relative links against it like a browser. */
function baseOf(url: string): string | undefined {
  try {
    return new URL(url).toString();
  } catch {
    return undefined;
  }
}

function convert(html: string, url: string, minimal: boolean): string {
  // Frontmatter is off: the title comes from <title> and the body stays clean.
  const markdown = mdream(html, { origin: baseOf(url), clean: true, minimal, frontmatter: false });
  return splitFrontmatter(markdown).body.trim();
}

export function htmlToMarkdown(html: string, url: string): Extracted {
  const title = htmlTitle(html);
  const main = convert(html, url, true);
  const mainWords = wordCount(main);
  if (mainWords >= MIN_MAIN_WORDS) return { title, markdown: main };
  const full = convert(html, url, false);
  return { title, markdown: wordCount(full) > mainWords ? full : main };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Title of an HTML page, entity-decoded. */
export function htmlTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = m?.[1]?.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e]).replace(/\s+/g, " ").trim();
  return raw || undefined;
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
