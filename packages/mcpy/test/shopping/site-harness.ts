/**
 * Shared helpers for shopping site tests: read a fixture through a site's
 * reader and normalize the rows exactly as the service does.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { Listing } from "mcpy";
import type { SiteQuery } from "../../src/sites/types.js";
import { normalize } from "../../src/sites/normalize.js";
import type { ReadOutcome, ShoppingSite, SitePage } from "../../src/sites/types.js";

export const fixture = (path: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/shopping/${path}`, import.meta.url)), "utf8");

export const query = (q: Partial<SiteQuery> = {}): SiteQuery => ({ query: "charizard", sort: "newest", page: 1, ...q });

export function page(content: string, url = "https://example.com/search", status = 200): SitePage {
  return { url, finalUrl: url, status, content };
}

/** The site's reader on a fixture, then normalize(): the listings the service would return. */
export function listings(site: ShoppingSite, content: string, url?: string, read: (p: SitePage) => ReadOutcome = (p) => site.read(p, query())): { outcome: ReadOutcome; listings: Listing[] } {
  const p = page(content, url ?? site.search(query()).url);
  const outcome = read(p);
  const rows = outcome.kind === "results" ? outcome.rows : [];
  return { outcome, listings: rows.map((r) => normalize(site, r, p.finalUrl)).filter((l): l is Listing => l !== undefined) };
}

/** A challenge page must read as failed: blocked, never as results or empty. */
export function expectBlockedReadsFailed(site: ShoppingSite): void {
  const challenge = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-platform"></div></body></html>';
  const outcome = site.read(page(challenge, site.search(query()).url), query());
  expect(outcome.kind).toBe("failed");
}

export type { SiteQuery };
