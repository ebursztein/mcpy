# Card stores: verdict (2026-11-22)

Readers live in `packages/mcpy/src/sites/cards/`, tests in `packages/mcpy/test/shopping/cards-*.test.ts`,
fixtures in `packages/mcpy/test/fixtures/shopping/cards/`. The live results come from
`scripts/live-shopping.ts` (named search, newest + price floor, nonsense query). Named queries:
"charizard" (US/EU Pokémon), "black lotus" (Magic shops), "リザードン" (JP shops).

| key | path chosen | live result | fields available | status | notes |
|---|---|---|---|---|---|
| tcgplayer | API: POST mp-search-api `/v1/search/request` (products), then POST `/v1/product/{id}/listings` (offers); no render | named 59; floor (50): applied by mcpy, 44 rows, all >= 50; nonsense: empty | per offer: price, shipping (>0), US grade -> card_condition, language, quantity, seller, rating %, listed date (custom listings), printing, sales | working | The API needs `Content-Type: application/json` (HTTP 415 without it). It is cross-game. |
| cardmarket | HTML search gallery (products) + HTML product page (offer rows); no render | named 100 offers from 2 products; floor (50): by mcpy, 0 rows (the 2 best-matching products only had offers below 50 €); nonsense: empty | per offer: price, grade (MT..PO) -> card_condition, language, quantity, seller, sales count, item location -> country, comment, extras (Reverse Holo...) | working | Plain fetch from Cloudflare times out and direct gets 401; served through the Firecrawl fallback. Pokémon path only (one path per game). |
| cardtrader | Embedded JSON: `BlueprintSearch` React props on `/en/search?q=&game=pokemon` (products), then the page's own JSON `/en/cards/{id}.json` (offers); no render | named 46; floor: by mcpy, 46, all >= 50; nonsense: empty | per offer: price, grade -> card_condition, language, quantity, seller, feedback count/%, seller country, graded/foil/first edition | working | Without `game` the search covers Magic only; no cross-game search, so Pokémon. |
| cardkingdom | HTML (server-rendered search page, direct fetch); no render | "black lotus": 36; floor (50): by mcpy, 32, all >= 50; nonsense: empty | per grade (NM/EX/VG/G): price, stock, sold_out | working | `filter[sort]` did not order rows; `filter[price]` filters on the NM price only, so both are left to mcpy. Magic only ("charizard" is a real empty). |
| starcitygames | HTML after render (HawkSearch inserts rows by script) | "black lotus": 9; floor: by mcpy, 6; nonsense: empty (the first run returned 11 spell-corrected rows; those now read as empty, rechecked live) | per grade variant (NM/PL/HP): price, stock count, sold_out, set, finish | working (render) | One paid render per search. No search endpoint found in page or theme bundle. `hawkspellcheck=0` does not stop the correction. |
| coolstuffinc | none | named / floor / nonsense: failed, blocked | - | failed | `/main_search.php?pa=searchOnName&q=...` (the site's own form target) answers HTTP 200 with an empty body to direct (this machine), Cloudflare, Firecrawl (render and not) and Bright Data. The home page fetches fine. |
| hareruya | API: `/en/products/search/unisearch_api` (JSON the search page calls); no render | "black lotus": 60 (of 100); floor (100000 JPY): applied by site, 20 rows, all >= floor; nonsense: empty | per stock unit: price, stock / sold_out, grade code -> card_condition, language (1 ja, 2 en), foil, image | working | Site applies `fq.price=min~max` and `sort=price asc|desc`; newest not available. A `responseHeader.fallback` (query words dropped) reads as empty. Grade codes 2=SP and 3=MP were confirmed on a product page; 1=NM, 4=HP, 5=DMG follow Hareruya's scale but were not seen labelled. Magic only. |
| yuyutei | HTML (server-rendered, direct fetch); no render | named 127; floor (5000): by mcpy, 59; nonsense: empty | price, stock count / ◯ / ×, rarity, card number, damaged (kizu) | working | Pokémon path (`/sell/poc/`): `/sell/all/` and `/sell/mtg/` answer 404. All matches on one page. |
| cardrush | HTML (server-rendered); no render | named 100 (of 2015); floor: by mcpy, 37; nonsense: empty | price, stock count, sold_out, state in title, set code | working | Direct from this machine gets 403; deployed Cloudflare escalates to a paid fallback. `order=asc|desc` sorts by price on the site; no newest. |
| dorasuta | HTML (server-rendered); no render | named 40 (of 179); floor: by mcpy, 38; nonsense: empty (first run read "redesigned"; fixed with the real no-match page, rechecked live) | price, quantity in stock, SOLDOUT, rarity, code, play grade / damaged flags | working | Direct 403, Cloudflare times out; served through Firecrawl. The pager and sort are JavaScript: first 40 rows only. |
| magi | HTML (server-rendered listing search); no render | named 96 (of 1183); floor (5000): applied by site, all >= floor; nonsense: empty | price, sold_out icon, certified seller, favorites, image; wanted posts -> format wanted, no price | working | Site applies sort (price_asc verified ascending; newest = "updated" order), from/to price, page; `status=presented` requested. No wanted post was seen live: the 【求】/買取 title rule is untested against a real one. |
| surugaya | HTML (server-rendered); no render | named 22 (12 priced; the rest 品切れ, sold_out); floor (5000): by mcpy, 1; nonsense: empty (HTTP 404 result page) | own used/new price per product, time-sale price, sold_out, category, release date, brand | working | Direct 403; served through paid fallbacks. General shop (keyholders, plush): the "マケプレ ￥N" lowest-of-other-sellers line is not a listing. |

## Games (`game` input)

| key | games (main first) | how the game is applied | verified |
|---|---|---|---|
| tcgplayer | pokemon, mtg, yugioh, one_piece, lorcana | `filters.term.productLineName` (magic; pokemon + pokemon-japan; yugioh; one-piece-card-game; lorcana-tcg), none without a game | live: "black lotus" + mtg, 17 offers, all Magic products; nonsense empty |
| cardmarket | pokemon, mtg, yugioh, one_piece, lorcana | path `/en/Pokemon|Magic|YuGiOh|OnePiece|Lorcana/` (all linked from the site menu) | live: "black lotus" + mtg, 53 offers from /en/Magic/ products; nonsense empty |
| cardtrader | pokemon, mtg, yugioh, one_piece, lorcana | `game=pokemon|magic|yu-gi-oh|one-piece|lorcana` | each slug served its own search (probe); live: "black lotus" + mtg, 3 offers; nonsense empty |
| yuyutei | pokemon, yugioh, one_piece | path `/sell/poc|ygo|opc/` | probes: ygo and opc serve result pages; no Magic or Lorcana path |
| cardkingdom, hareruya | mtg | Magic-only sites | - |
| starcitygames | mtg | the search covers all games SCG sells; rows without the `magic-the-gathering` class are dropped | only Magic rows seen live; other games' row classes not seen |
| cardrush, dorasuta | pokemon | Pokémon-only domain / path (other dorasuta game paths not probed) | - |
| magi, surugaya, coolstuffinc | not set | general searches across all games; no game filter found | - |

Scryfall was not used: every Magic store here has its own search, and its terms forbid proxying its data.

## Next steps

- coolstuffinc: find out what the search needs (a session cookie from the home page, a header, or an
  API behind the form). It needs a request the engine cannot make today (cookies carried between two
  fetches), or a render through a provider with sessions. Until then it reports `blocked`.
- dorasuta: probe its other game paths (e.g. Yu-Gi-Oh!, One Piece) and add them to `games`.
- magi: has per-game categories; a verified category parameter would let it honour `game`.
- cardmarket floor: the product page has offer filters; a verified price filter there would make the
  floor useful (today mcpy filters the offers of the best-matching products, often all below it).
- dorasuta: paging and sort need the site's AJAX endpoint (not found in the page).
