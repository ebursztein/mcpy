/**
 * Small, allocation-light HTML helpers for card markup. No DOM: Workers have
 * none and pages are megabytes. Blocks are cut between repeated start tags,
 * so a reader works on one card's markup at a time.
 */

import { findObjects, parseJson } from "./json.js";

const NAMED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", pound: "£", yen: "¥" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/** Visible text of a fragment: tags dropped, entities decoded, whitespace collapsed. */
export function text(fragment: string | undefined): string | undefined {
  if (fragment === undefined) return undefined;
  const t = decodeEntities(fragment.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return t || undefined;
}

/** Value of an attribute in a tag string (first match), entities decoded. */
export function attr(tag: string | undefined, name: string): string | undefined {
  if (!tag) return undefined;
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  const v = m ? (m[1] ?? m[2] ?? m[3]) : undefined;
  return v === undefined ? undefined : decodeEntities(v);
}

/** The fragments between successive matches of `start` (each fragment begins at its match). */
export function blocks(html: string, start: RegExp, limit = 200): string[] {
  const re = new RegExp(start.source, start.flags.includes("g") ? start.flags : start.flags + "g");
  const at: number[] = [];
  for (let m = re.exec(html); m && at.length < limit + 1; m = re.exec(html)) {
    at.push(m.index);
    if (m[0].length === 0) re.lastIndex++;
  }
  return at.slice(0, limit).map((s, i) => html.slice(s, at[i + 1] ?? Math.min(html.length, s + 20_000)));
}

/** First capture of `re` in `s`. */
export function first(s: string | undefined, re: RegExp): string | undefined {
  return s ? (re.exec(s)?.[1] ?? undefined) : undefined;
}

/** The opening tag that contains the match of `re` (e.g. the <a ...> around an href). */
export function tagAround(s: string, re: RegExp): string | undefined {
  const m = re.exec(s);
  if (!m) return undefined;
  const open = s.lastIndexOf("<", m.index);
  const close = s.indexOf(">", m.index);
  return open >= 0 && close > open ? s.slice(open, close + 1) : undefined;
}

/** Every schema.org object of the given @type from the page's JSON-LD blocks (@graph and ItemLists flattened). */
export function jsonLd(html: string, type?: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const value = parseJson(decodeEntities(m[1]!.trim())) ?? parseJson(m[1]!.trim());
    if (value === undefined) continue;
    out.push(...findObjects(value, (o) => !type || o["@type"] === type || (Array.isArray(o["@type"]) && (o["@type"] as unknown[]).includes(type))));
  }
  return out;
}

/**
 * Whether the page looks like a bot challenge rather than the site. Titles
 * are matched whole: a result page's title holds the query or a listing title
 * ("Access Denied LP", a search for "security check"), so a substring would
 * read real results as blocked.
 */
const CHALLENGE_TITLE = /^(just a moment\.*|attention required!?( \| cloudflare)?|access denied|captcha|are you a (robot|human)\??|verify you are (a )?human|pardon our interruption|security check(point)?|one moment,? please[.…]*|einen moment,? bitte[.…]*|shieldsquare captcha)$/i;

export function looksBlocked(html: string, title?: string): boolean {
  const head = (title ?? first(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? "").replace(/\s+/g, " ").trim();
  if (CHALLENGE_TITLE.test(head)) return true;
  return html.length < 30_000 && /cf-chl-|\/cdn-cgi\/challenge-platform\/|captcha-delivery\.com|px-captcha|_Incapsula_Resource|awsWafCookieDomainList|validate\.perfdrive\.com/i.test(html);
}
