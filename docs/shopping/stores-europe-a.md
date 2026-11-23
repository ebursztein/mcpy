# Shopping stores: europe-a

Probed 2026-11-22 through tools.ly.tl (`scripts/probe-page.mjs`), live-checked with
`scripts/live-shopping.ts --min 50` (query "charizard"; nonsense "qzxjvwk glurak zzqv").
Code: `packages/mcpy/src/sites/europe/a/`. Tests: `packages/mcpy/test/shopping/europe-a-*.test.ts`.

Almost every site here matches *any* query word, tolerates typos or adds vector look-alikes
(a nonsense query returns tractors on OLX and "Glurak" cards on Marktplaats; "black lotus"
returns Lotus cars). Those rows are filler, so `shared.ts` keeps a row only when every query
word appears in its title or body (accents and case folded). OLX Ukraine and Bulgaria use a
page gate instead (sellers transliterate the query into Cyrillic): the page is empty when no
row has every word. When rows are dropped, the site's total is not reported.

| key | path chosen | live result | fields | status | notes |
|---|---|---|---|---|---|
| leboncoin | embedded JSON (`__NEXT_DATA__` searchData.ads), no render | named 35; floor applied by site (all >= 50); nonsense empty | price, posted_at (Paris time), location, seller + rating count, shipping (cheapest), condition, promoted, image | working | DataDome: a plain fetch from the deployed worker often escalates to a paid source (attempts 2). No relevance filter (site matches all words; rows have no body). |
| subito | embedded JSON (`__NEXT_DATA__` items.originalList), no render | named 30; floor by mcpy (22 left); nonsense empty | price, posted_at (Italy time), shipping, condition, location, seller, promoted (vetrina), image | working | `ps`/`pe` are ignored across all categories (filters stay `{}`), so the floor is mcpy's. galleryList (paid carousel) never read. |
| marktplaats | API `/lrp/api/search` (JSON), no render | named 24; floor applied by site; nonsense empty | price (FIXED / MIN_BID), format, posted_text, location, seller, reserved status, promoted (DAGTOPPER), condition, image | working | Dates are text ("Vandaag", "6 sep 26"): posted_text only. FAST_BID/SEE_DESCRIPTION rows carry no price. |
| 2dehands | same API as marktplaats | named 28; floor applied by site; nonsense empty | as marktplaats | working | |
| willhaben | embedded JSON (`__NEXT_DATA__` advertSummaryList), no render | named 21; floor applied by site; nonsense empty | price, posted_at (UTC), status, location, seller type, image | working | sort=1/3/4/7, PRICE_FROM/TO, page all applied. |
| ricardo | Next flight data (`articles`), no render | named 26; floor applied by site; nonsense empty | current bid / buy-now, bids, ends_at, shipping, condition, location, posted_at, promoted, image | working | Only sort=newest was verified (other sort values not sent). URL built from the image slug + id. Title-only relevance. |
| tutti | embedded JSON (`__NEXT_DATA__` dehydrated SearchListingsByConstraints), no render | named 19; floor by mcpy; nonsense empty | price, posted_at, location, seller, promoted, image | working | Search URL is a msgpack token we build; the price constraint inside it could not be decoded (12 layouts tried: ignored or rejected), so the floor is mcpy's. A page echoing another query (bad token falls back to all listings) reads as redesigned. Escalates to paid on first fetch. |
| anibis | same platform as tutti | named 13; floor by mcpy; nonsense empty | as tutti | working | |
| catawiki | API `/buyer/api/v1/search` (JSON) + `enrich` follow-up `/buyer/api/v3/bidding/lots?ids=...` (JSON), no render | named 24 (all priced); floor by mcpy on enriched rows (2 of 24 >= 50 on page 1, floorOk); nonsense empty | current bid as price (starting bid when no bidder: bids 0), ends_at, buy-now, card grade + language (from subtitle), free shipping, bidding start, closed / reserve met, image | working | Both requests are plain fetches. The bidding API has no bid count (only "no bidder" -> 0). The site offers relevance and closing-date sort only and every API sort value tried returned HTTP 422, so sort is reported ignored; budget params had no effect, so the floor is mcpy's and a floored page can be short. |
| olx_pl | API `/api/v1/offers/` (JSON), no render | named 39; floor applied by site; nonsense empty | price + currency, negotiable -> best_offer, condition, posted_at, location, seller, promoted, image | working | Partner listings on otodom/otomoto hosts are dropped by normalize. |
| olx_pt | same | named 40; floor applied by site; nonsense empty | as olx_pl | working | |
| olx_ro | same | named 40; floor applied by site; nonsense empty | as olx_pl | working | |
| olx_bg | same (EUR) | named 33; floor applied by site; nonsense empty | as olx_pl | working | Page-gate relevance (Cyrillic transliteration). |
| olx_ua | same (UAH) | named 40; floor applied by site; nonsense empty | as olx_pl | working | Page-gate relevance (Cyrillic transliteration). |

## Next steps

- catawiki: find the search API's sort parameter name (the site has a "closing date" sort)
  and a working budget filter, so floored pages fill up on the site's side.
- tutti/anibis: decode the price slot of the search token (watch the site's own URL after
  setting a price in a browser) so the floor moves to the site.
- ricardo: verify `sort` values for price and ending soon before sending them.
- `shared.ts` relevance and CET helpers are generic; promote them to `sites/readers/` once
  another group needs them.
