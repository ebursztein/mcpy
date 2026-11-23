# Shopping stores: status (2026-11-23)

`shopping_search` covers 75 store keys behind one listing format. Each group
file next to this one records the path chosen per store and its live checks:
[asia](stores-asia.md), [cards](stores-cards.md), [ebay-americas](stores-ebay-americas.md),
[europe-a](stores-europe-a.md), [europe-b](stores-europe-b.md), [europe-c](stores-europe-c.md).

Final live sweep (59 ok, 6 empty, 9 failed of 74), then rechecks: one named search per store through the real SDK path
(direct fetch from a laptop, Firecrawl and Bright Data fallbacks), after the
review fixes. The 6 empty ones were rechecked with a query their site has: Magic-only shops (cardkingdom 36, starcitygames 9, hareruya 60 rows) with "black lotus", Locanto (de 24, fr 3, gb 2) with
"pokemon"; every other store with "charizard" / リザードン / 리자몽.

| Result | Count | Stores |
| --- | --- | --- |
| Working | 67 | every store not listed below (`ebay`, added 2026-11-23 after the sweep, checked live on its own; since then every eBay store reads eBay's Browse search first, free); ebay_de is blocked on about one call in three (final sweep blocked; recheck: named 60 rows, floor 60 rows all >= 50 EUR, nonsense blocked) |
| Failed | 7 | mercadolivre_br, mercadolibre_ar, mercadolibre_mx, mercadolibre_cl, mercadolibre_co, coolstuffinc, sahibinden |
| Failed (site) | 1 | locanto_it: the site's TLS certificate does not cover www.locanto.it, and http redirects to a 403 |

## Failed stores and next steps

| Store | What fails | Next step |
| --- | --- | --- |
| MercadoLibre (5) | Plain fetch lands on `/gz/account-verification`; from a laptop `/captcha/wall`; the public API answers 403 (needs OAuth); Firecrawl fails; Bright Data served the real page once, then answered HTTP 402 | Top up / check the Bright Data zone (402 is out of credit or over quota), then rerun; or register a MercadoLibre app for the official API (OAuth) |
| coolstuffinc | Its search URL returns HTTP 200 with an empty body on every engine | Try the render path with a wait once Browser Rendering is deployed; otherwise drop |
| sahibinden | Every plain path is 403; Firecrawl is redirected to the login page | Needs a logged-in session or a Turkish residential exit; out of reach for now |
| locanto_it | Broken TLS on the site itself | Watch for the site to come back; drop if it does not |
| ebay_de (working, flaky) | Paid fallbacks are blocked on it about one call in three | Deploy the render build (Cloudflare Browser Rendering) and recheck. Since 2026-11-23 the eBay sites fall back to a listing API (Serpent) when every page source fails; it answered 2 of 5 live calls, in 30-45 s |
| ebay_us (2026-11-23) | From production, every page source failed (502, 403) | Same listing API fallback; Litescrape's eBay search (richer rows, 2 s) is a candidate second source once its eBay endpoint is back up |

## Known limits (working stores)

- Paid path (a plain fetch is blocked, so each search costs a fallback): leboncoin, ebay_*, todocoleccion, skelbiu, adverts_ie, jofogas, njuskalo, locanto_*, surugaya, dorasuta, cardmarket (render), starcitygames (render), mercari_jp (render, from Japan).
- Local filtering: where a site cannot apply a filter, mcpy applies it on the page it read and reports it in `ignored` (e.g. Catawiki and Subito price floors, Card Kingdom sort).
- Multi-game shops without a game filter (magi, surugaya, coolstuffinc) report `game` as ignored.
- `shopping_item` reads JSON-LD Product pages; card marketplaces are refused (their listing URL is a shared product page), and app-shell sites (Mercari, Wallapop, Bunjang) have no item reader yet.
- Results that only partly match the query are dropped by some readers (Europe A `shared.ts`) without a count in the report.
