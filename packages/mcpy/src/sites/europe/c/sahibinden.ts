/**
 * sahibinden.com (Turkey). Probed 2026-11-22, nothing serves search rows:
 * - plain fetch of /arama?query_text= from Cloudflare and from a residential
 *   IP: HTTP 403 (14 KB challenge page);
 * - /ajax/search/autocomplete: HTTP 403;
 * - Firecrawl (basic proxy): HTTP 200 but redirected to
 *   secure.sahibinden.com/login ("sahibinden.com Log In"): search needs a
 *   signed-in session.
 * No result page was ever seen, so no row reader is written: guessing at
 * markup would produce rows nobody checked. Every page reads as failed
 * (blocked for the challenge and login pages); the service already reports
 * the cross-host login redirect as `redirected`.
 */

import { looksBlocked } from "../../readers/html.js";
import { q } from "../../readers/values.js";
import { SiteKind, type ShoppingSite } from "../../types.js";

export const sahibinden: ShoppingSite = {
  key: "sahibinden",
  host: "www.sahibinden.com",
  country: "tr",
  currency: "TRY",
  language: "tr",
  kind: SiteKind.Classifieds,
  listingId: (url) => /^\/ilan\/[^/]*-(\d+)\/detay\/?$/.exec(url.pathname)?.[1],
  search(sq) {
    return { url: `https://www.sahibinden.com/arama?query_text=${q(sq.query)}${sq.page > 1 ? `&pagingOffset=${(sq.page - 1) * 20}` : ""}` };
  },
  read(page) {
    if (looksBlocked(page.content) || /\/login\b/.test(page.finalUrl) || /<title>[^<]*Log ?In|<title>[^<]*Giriş/i.test(page.content) || page.content.length < 30_000) {
      return { kind: "failed", failure: "blocked", detail: "challenge or sign-in page" };
    }
    return { kind: "failed", failure: "redesigned", detail: "no verified reader: sahibinden search has only ever answered with a challenge or a sign-in page" };
  },
};
