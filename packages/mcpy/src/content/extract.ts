/**
 * HTML -> markdown for LLMs, via mdream (Rust/WASM, ~100x faster than
 * DOM-based converters, with a dedicated workerd build).
 *
 * Main-content isolation: mdream's `minimal` mode drops nav, footers, forms
 * and asides. It occasionally drops nearly everything (table layouts such as
 * Hacker News), so when it keeps less than MIN_MAIN_SHARE of the full page's
 * words we return the cleaned full page instead. Too much text beats
 * silently missing content.
 */

import { htmlToMarkdown as mdream } from "mdream";

export interface Extracted {
  title?: string;
  markdown: string;
}

/** `minimal` must keep at least this share of the full page's words. */
export const MIN_MAIN_SHARE = 0.25;
/** Below this many words in the full page, isolation is not worth it. */
const MIN_WORDS_FOR_ISOLATION = 150;

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
  const full = convert(html, url, false);
  const fullWords = wordCount(full);
  if (fullWords < MIN_WORDS_FOR_ISOLATION) return { title, markdown: full };

  const main = convert(html, url, true);
  const keepsEnough = wordCount(main) >= fullWords * MIN_MAIN_SHARE;
  return { title, markdown: keepsEnough ? main : full };
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
