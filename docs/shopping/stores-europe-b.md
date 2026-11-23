# Shopping stores: europe-b

Probed and checked live on 2026-11-22. "Production" means tools.ly.tl, a
plain fetch from Cloudflare IPs (`scripts/probe-page.mjs`). "Live" means
`scripts/live-shopping.ts`: a direct fetch from a residential IP, then the
Firecrawl and Bright Data fallbacks. No store needs `render`.

| key | path chosen | live result | fields | status | if not working |
|---|---|---|---|---|---|
| finn | API: `/recommerce/forsale/search/api/search/SEARCH_ID_BAP_COMMON` (JSON the search page calls), plain GET, no render | named 53 rows; floor applied by site (floorOk); nonsense empty | title, price+currency, posted_at, location, image, business seller, shipping/buy-now details, wanted | working | |
| blocket | same API on www.blocket.se | named 53; floor by site; nonsense empty | same as finn | working | |
| dba | same API on www.dba.dk | named 53; floor by site; nonsense empty | same as finn | working | |
| tori | same API on www.tori.fi | named 53; floor by site; nonsense empty | same as finn | working | |
| allegro_lokalnie | HTML cards (`<article itemtype=Offer>`) plus JSON-LD ItemList for the condition, no render | named 51; floor by site (`price_from`); nonsense empty | title, price, fixed/auction/best offer, bids, ends_at, condition, town, promoted (sponsored block), image, seller type | working | |
| aukro | embedded JSON: Angular `script#ng-state`, cached `searchItemsCommon` response, no render | named 60 (total 249); floor applied by mcpy (`ignored: sort`); nonsense empty | title, price, auction/fixed, ends_at, buy_now, shipping, condition, quantity, posted_at, location, seller with feedback count/%, promoted, image | partial | Popular words (pokemon, charizard) redirect to a curated landing page `/lp/nejkvalitnejsi-WORD` that drops `sort`/`priceMin`, so `applies` is unset and mcpy filters and sorts the 60 rows itself. On real search pages the site does apply `sort=startingTime:DESC` and `priceMin`/`priceMax`. The POST API is behind a Cloudflare challenge when called directly and answers 405 through the deployed fetch. Production needed 2 attempts once. |
| jofogas | embedded JSON: `__NEXT_DATA__` `props.pageProps.adList`, no render | named 22 (paid fallback, attempts 2); floor applied by site (floorOk); nonsense empty | title, price, posted_at, condition, location, seller, business flag, promoted, image, wanted | working (paid path) | Production and the SDK's direct fetch get an AWS WAF challenge (HTTP 202). The engine now counts it as a challenge and escalates to a paid fallback. The re-run also found a reader bug, now fixed: the real no-results page has no `adList.ads` key (mode "none", search_total 0), and it had read as `redesigned`. |
| njuskalo | embedded JSON: `window.__INITIAL_STATE__` `searchPage.pageData` (same reader as bolha), no render | named 25 (total 58; paid fallback, attempts 2); floor applied by site (floorOk); nonsense empty | title, price, condition, posted_at, location, seller, promoted, image | working (paid path) | Plain fetches hit a ShieldSquare captcha: a 302 to validate.perfdrive.com, now treated as a challenge by the engine. Searches go through a paid fallback. It no longer ends as `redirected`. |
| bolha | embedded JSON: `window.__INITIAL_STATE__` `searchPage.pageData` (promoted then regular rows; the latest-ads sidebar is ignored), no render | named 15; floor by site (`price[min]`, `sort=new`); nonsense empty | title, price, condition, posted_at, location, seller (+review count), promoted, image | working | |
| locanto_de | HTML cards `<article data-msgid data-unix>`, no render | named 24 (Firecrawl, attempts 2); floor applied by mcpy; nonsense empty | title (town split off), price, posted_at, town, description, category, image | working (paid path) | Production and direct fetches get a Cloudflare challenge ("Einen Moment bitte...", 403), so every search goes through a paid fallback. No sort or price URL parameter was verified, so mcpy sorts and filters. |
| locanto_fr | same module as locanto_de | named 3 (the site has only 3 "pokemon" rows; attempts 2); floor applied by mcpy; nonsense empty | same | working (paid path) | Same as locanto_de. |
| locanto_es | same module | named 24 (total 26; attempts 2); floor applied by mcpy; nonsense empty | same | working (paid path) | Same as locanto_de. |
| locanto_it | same module | named, floor and nonsense all failed: `upstream_failed`, attempts 0 | none | failed | https://www.locanto.it serves a TLS certificate for `locanto.info` that does not cover www.locanto.it (curl exit 60). http://www.locanto.it 301-redirects to http://de.locanto.it/, which answers 403. Direct, Firecrawl and Bright Data all failed. Locanto Italy looks broken or moved. |
| locanto_gb | same module | named 2 (the site has only 2 "pokemon" rows); floor applied by mcpy; nonsense empty | same | working (paid path) | Same as locanto_de. Long titles are cut with "…" on the card. |
| kleinanzeigen | HTML cards in `ul#srchrslt-adtable` (no embedded state or public API), no render | named 27; floor by site (`/s-preis:MIN:MAX/…`); nonsense empty | title, price, best offer (VB), wanted (Gesuch), posted_at (date) or posted_text (Heute/Gestern), postcode+town, PRO shop seller, TOP ad marked promoted, shipping/direct-buy details, image | working | |

Checked on the site's side (every row at or above the floor, or newest first):
- The Nordic API: `sort=PUBLISHED_DESC|PRICE_ASC|PRICE_DESC`, `price_from`, `price_to`.
- Kleinanzeigen: `preis:MIN:MAX`, `seite:N` and `sortierung:neuste`, all in one path.
- Bolha: `price[min]` and `sort=new`.
- Jófogás: `min_price`, `sp=3` (newest) and `o=N` (page).
- Allegro Lokalnie: `price_from`; the sort values are the site's own select options.

## Next steps

- **Done (by the coordinator):** the engine now counts AWS WAF, ShieldSquare and localized Cloudflare pages as challenges. jofogas and njuskalo now work through a paid fallback. The old item is kept below for the record.
- **Engine (outside this group's folder): add the missing challenge signatures.** This would make jofogas and njuskalo work through the paid fallbacks:
  - AWS WAF: HTTP 202 with `awsWafCookieDomainList`, `AwsWafIntegration` or `challenge-container`.
  - ShieldSquare: a redirect to `validate.perfdrive.com` or the title "ShieldSquare Captcha".
  - Localized Cloudflare titles: "One moment please...", "Einen Moment bitte...".

  The site readers already return `blocked` for these pages.
- **fetch-site (outside this group's folder): escalate a cross-host redirect to a known bot wall.** Today it fails as `redirected`. It should be treated as blocked and go to the next provider.
- **locanto_it:** find Locanto's current Italian host, or drop the site. www.locanto.it now has a mismatched certificate and redirects to de.locanto.it, which answers 403.
- **aukro:** find a URL that searches without the landing-page redirect. Then set `applies` for sort and price.
- **locanto:** look for sort and price URL parameters on a fallback-fetched page, so the site can apply them.
