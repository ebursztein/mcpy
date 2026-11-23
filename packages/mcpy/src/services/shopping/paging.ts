/**
 * Where each site stands between calls. next_cursor carries one position per
 * site, so nothing is skipped: rows a call could not return (max_results)
 * come first on the next call, product pages are walked max_products at a
 * time before the site's next search page, and cursor-paged sites keep their
 * own token. Re-reading a page is a cache hit within max_age.
 */

import { ErrorCode } from "../../enums.js";
import { McpyError } from "../../errors.js";
import { sha256Hex } from "../../http/url.js";
import { MAX_SITE_TOKEN_CHARS } from "../common.js";
import type { Marketplace } from "./marketplace.js";
import type { ShoppingSearchQuery } from "./schema.js";

/** One site's place in the results. */
export interface SitePosition {
  /** Search page (1-based), for page-numbered sites. */
  p: number;
  /** The site's own next-page token, for cursor-paged sites. */
  c?: string;
  /** Rows of this page already returned. */
  o: number;
  /** Product pages of this search page already opened. */
  x: number;
  /** Retries of this position after a transient failure. */
  r?: number;
}

/** A position that keeps failing is given up after this many retries. */
export const MAX_RETRIES = 2;

export type Positions = Partial<Record<Marketplace, SitePosition>>;

export const MAX_SEARCH_PAGE = 20;
const START: SitePosition = { p: 1, o: 0, x: 0 };

/** The cursor names the inputs it was made for (an unkeyed hash: a guard against mistakes, not forgery). */
async function inputKey(input: ShoppingSearchQuery): Promise<string> {
  const { cursor: _c, max_age: _m, ...rest } = input;
  return (await sha256Hex(JSON.stringify(rest))).slice(0, 16);
}

const fromBase64Url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
const toBase64Url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const wholeIn = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function validPosition(v: unknown): v is SitePosition {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const tokenOk = s["c"] === undefined || (typeof s["c"] === "string" && s["c"].length > 0 && s["c"].length <= MAX_SITE_TOKEN_CHARS);
  const retriesOk = s["r"] === undefined || wholeIn(s["r"], 1, MAX_RETRIES);
  return wholeIn(s["p"], 1, MAX_SEARCH_PAGE) && wholeIn(s["o"], 0, 10_000) && wholeIn(s["x"], 0, 1_000) && tokenOk && retriesOk;
}

/** Positions to start this call from: every site at its start, or where the cursor left it. Sites absent from a cursor are done. */
export async function positionsOf(input: ShoppingSearchQuery): Promise<Positions> {
  if (!input.cursor) return Object.fromEntries(input.marketplaces.map((k) => [k, { ...START }]));
  try {
    const parsed = JSON.parse(fromBase64Url(input.cursor)) as { k?: unknown; s?: unknown };
    const sites = parsed.s && typeof parsed.s === "object" ? (parsed.s as Record<string, unknown>) : undefined;
    if (parsed.k === (await inputKey(input)) && sites) {
      const entries = Object.entries(sites);
      const valid = entries.length > 0 && entries.every(([k, v]) => Object.hasOwn(sites, k) && input.marketplaces.includes(k as Marketplace) && validPosition(v));
      if (valid) return Object.fromEntries(entries) as Positions;
    }
  } catch {
    // fall through
  }
  throw new McpyError(ErrorCode.InvalidInput, "cursor does not belong to this search", ["pass next_cursor with the same other inputs"]);
}

/** What one site did this call, to decide where it continues. */
export interface SiteProgress {
  at: SitePosition;
  /** Rows available from `at.o` on, and how many of them this call returned. */
  available: number;
  returned: number;
  /** Product links on the search page, and how many this call opened (product sites). */
  products?: number;
  opened?: number;
  /** The site said there is a next search page, and its token if it pages by cursor. */
  hasMore: boolean;
  nextToken?: string;
  /** The site reported empty or a lasting failure: it is not asked again. */
  stop: boolean;
  /** A transient failure: ask again from the same place next call. */
  retry?: boolean;
}

/** Where the site continues, or undefined when it is done. */
export function advance(s: SiteProgress): SitePosition | undefined {
  if (s.stop) return undefined;
  if (s.retry) return (s.at.r ?? 0) < MAX_RETRIES ? { ...s.at, r: (s.at.r ?? 0) + 1 } : undefined;
  const { r: _r, ...at } = s.at;
  s = { ...s, at };
  if (s.returned < s.available) return { ...s.at, o: s.at.o + s.returned };
  if (s.products !== undefined && s.opened !== undefined && s.at.x + s.opened < s.products) return { ...s.at, o: 0, x: s.at.x + s.opened };
  if (!s.hasMore || s.at.p >= MAX_SEARCH_PAGE) return undefined;
  if (s.nextToken !== undefined) return s.nextToken.length <= MAX_SITE_TOKEN_CHARS ? { p: s.at.p + 1, c: s.nextToken, o: 0, x: 0 } : undefined;
  return { p: s.at.p + 1, o: 0, x: 0 };
}

export async function encodeCursor(input: ShoppingSearchQuery, next: Positions): Promise<string | undefined> {
  if (!Object.keys(next).length) return undefined;
  return toBase64Url(JSON.stringify({ k: await inputKey(input), s: next }));
}
