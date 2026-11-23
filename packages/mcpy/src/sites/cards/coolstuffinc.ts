/**
 * CoolStuffInc. Probed 2026-11-22: the home page answers a direct fetch, but
 * its own search form target (/main_search.php?pa=searchOnName&q=...) comes
 * back as HTTP 200 with an empty body to every engine (direct from this
 * machine, Cloudflare, Firecrawl with and without render, Bright Data). No
 * result page has ever been seen, so no row reader is written against a
 * guess: an empty body reads as blocked and anything else as redesigned,
 * which tells the caller exactly what happened.
 */

import { SiteFailure } from "../../services/common.js";
import { looksBlocked, text } from "../readers/html.js";
import { plus } from "../readers/values.js";
import { SiteKind, type ShoppingSite } from "../types.js";

const ORIGIN = "https://www.coolstuffinc.com";

export const coolstuffinc: ShoppingSite = {
  key: "coolstuffinc",
  host: "www.coolstuffinc.com",
  country: "us",
  currency: "USD",
  language: "en",
  kind: SiteKind.Shop,
  listingId: (url) => /^\/p\/(\d+)/.exec(url.pathname)?.[1],
  search(sq) {
    return { url: `${ORIGIN}/main_search.php?pa=searchOnName&page=${sq.page}&resultsPerPage=25&q=${plus(sq.query)}` };
  },
  read(page) {
    if (looksBlocked(page.content) || !text(page.content)) {
      return { kind: "failed", failure: SiteFailure.Blocked, detail: "empty body: the search answers automated clients with an empty page" };
    }
    return { kind: "failed", failure: SiteFailure.Redesigned, detail: "no reader for this page yet: no result page has been observed" };
  },
};
