# mcpy shopping tools: what cardy can use (2026-11-23)

You reach mcpy at `https://tools.ly.tl/mcp` (MCP) or `https://tools.ly.tl/v1/*` (REST) with your
cardy key. Six tools: `web_fetch`, `web_grep`, `web_search`, `paper_search`, and two new ones,
`shopping_search` and `shopping_item`. Your paid spend is capped at **$0.40 a day** across every
tool and both entry points: `web_fetch`, `/v1/fetch`, `web_search` and the shopping tools all count
against the same cap. Free sources keep working after the cap; paid ones stop until midnight UTC (a
site then reports `over_budget`).

**What a call costs** is in every response: `meta.cost_usd` for the call, and `cost_usd` on each
store's report in `marketplaces[]`. Cache hits cost 0. A store is free when its page is fetched
directly; it costs when the page must be rendered in a browser (Mercari, StarCityGames: about
$0.0005) or when the store blocks direct fetches and a paid source serves it (an eBay store does only when its free source fails:
about $0.004 a page), and card marketplaces pay once per product page they open. Spend scales
with how often a paid store is fetched, not with how many stores you use: search the expensive ones
less often (a longer `max_age` serves a repeat from cache for free) rather than leaving them out.
Read `cost_usd` on a few calls per store to set each store's frequency.

**Your own usage** is one call away: the `usage` tool (or `GET /v1/usage`) gives today's spend,
your cap and what is left, and your calls, paid calls, cache hit rate, errors, cost and time by
tool, domain, store, search type and day (`days` up to 30). `usage_log` (or `GET /v1/usage/log`)
lists your calls, newest first, with the query, args, domain, store, cost, cache hit and time;
filter with `tool`, `domain`, `store`, `search_type`, `query`, `paid_only`, `errors_only` or
`cache_hits_only`. A fetch is free only when the site answers a plain request: sites that block
it or need JavaScript (TCGplayer product pages, Cardmarket) cost money.

## shopping_search: one call, many stores, one listing format

Every result is **one listing on one store**: a seller's asking price (or current bid) for one item.
Nothing is merged across stores and nothing is guessed: a field the page does not state is absent.
Card marketplaces (Cardmarket, TCGplayer, CardTrader) return **every seller's offer** on the
product pages they open, each as its own listing.

Input:

| field | use |
| --- | --- |
| `marketplaces` | 1-10 store keys (list below). Each key is one domain with its own currency, except `ebay` (every eBay site, each row in its seller's currency). |
| `query` | Write it as a seller on that site would, **in the site's language**: `リザードン` on Japanese sites, `Glurak` on German ones, `리자몽` on Korean ones. Use one call per language. |
| `sort` | `newest` (default), `relevance`, `price_low`, `price_high`, `ending_soon`. Use `relevance` to find a specific card; `newest` returns loosely related items first on eBay. |
| `min_price` / `max_price` | In **each site's own currency**. Mixing USD and JPY sites in one call with one bound is usually wrong: split the call. |
| `condition` | `new`, `open_box`, `refurbished`, `used`, `for_parts` (general goods). |
| `game` | `pokemon`, `mtg`, `yugioh`, `one_piece`, `lorcana`. Card sites that do not sell it report `unsupported`. |
| `card_condition` | This grade or better on Cardmarket's scale: `mint` > `near_mint` > `excellent` > `good` > `light_played` > `played` > `poor`. |
| `language` | Cards printed in these languages (ISO codes: `en`, `ja`, `de`...). |
| `format` | `fixed_price`, `auction`, `best_offer`, `wanted` (a buyer's post, never an ask). |
| `seller_country` | Items located in these countries (`["jp"]`). eBay applies one country itself; otherwise mcpy keeps rows whose `country` matches. |
| `seller` | One seller's listings, by the name the store shows. |
| `category` | The store's own category id, from `facets` (eBay: `183454` is single trading cards). |
| `attributes` | Item specifics as the store names them, from `facets`, any value matching: `{"Grade": ["10"], "Professional Grader": ["Professional Sports Authenticator (PSA)"]}`. Needs `category` (or `game`) on eBay. |
| `facets` | `true`: each store that states them reports its categories and item specifics with counts, to pick `category` and `attributes`. Costs nothing extra on eBay but makes the reply larger: ask once, then search with the filters. |
| `title_match` | `auto` (default), `all_words`, `phrase`, `any`. Rows whose title lacks the query are dropped. `auto` is `all_words` on the stores that match loosely (Rakuma, PayPay Flea, Leboncoin, Milanuncios, Wallapop) and `any` elsewhere. Use `phrase` for names like "black lotus"; avoid `all_words` on card marketplaces, whose rows carry the product's name, not your words. |
| `max_results` | Listings in total for the call, up to 60 (spread across stores). |
| `max_products` | Card marketplaces: product pages to open, 1-10 (default 3). **Each one is a fetch and costs money**; keep it at 1-3. |
| `cursor` | `next_cursor` from the previous call, with **exactly the same other inputs**, for the next listings. |
| `max_age` | Seconds of cache you accept (default 900). 0 forces a fresh fetch (and costs more). |

Each listing can carry: `marketplace`, `id`, `url` (no tracking), `title` (as the seller wrote it,
not translated), `price` `{amount, currency}`, `format`, `auction` `{bids, ends_at, buy_now}`
(for an auction `price` is the current bid, not an ask), `price_converted` (see eBay below), `shipping` (amount 0 = free),
`condition`, `card_condition`, `language`, `quantity`, `product` (the product page an offer sits
on), `status`, `posted_at` or `posted_text`, `location`, `country`, `seller` `{name,
feedback_count, feedback_percent}`, `promoted`, `image`, and `details` (site-specific key/values).

Each store gets a report in `marketplaces[]`: `status` is `ok`, `empty` (a real "no results"
page), `unsupported`, `over_budget` or `failed` with a `failure`: `blocked`, `redesigned`,
`redirected`, `timeout` or `upstream_failed`. **A failed store never fails the call.** `ignored`
lists filters that store could not apply; when it lists `min_price`, `max_price` or `sort`,
mcpy applied them itself on the rows it read, so they still hold for that page. `total` is the
store's own result count when it states one; it is left out when `unmatched` (rows dropped by
`title_match`) is present, because the store counted those too.

Prices are never converted. Compare across currencies yourself, and say so when you do.

## shopping_item: one listing in full

`{ "url": <a listing url from shopping_search> }` returns the same fields plus `description`,
all `images` and a longer `details` map. It reads the listing page's JSON-LD. It refuses card
marketplace URLs (their "listing" URL is a product page shared by every seller), and Mercari,
Wallapop and Bunjang have no item reader yet.

## Stores (75 keys): what works

Working (67). Card-relevant ones first:

| key | site | currency | notes |
| --- | --- | --- | --- |
| `cardmarket` | cardmarket.com | EUR | All five games; seller offers with card condition, language, seller. Product pages cost a rendered fetch each. Sort is ignored. |
| `tcgplayer` | tcgplayer.com | USD | All five games; seller offers. Sort is ignored. |
| `cardtrader` | cardtrader.com | EUR | All five games; seller offers. |
| `cardkingdom`, `starcitygames` | | USD | Magic only. |
| `hareruya` | hareruyamtg.com | JPY | Magic only. |
| `yuyutei` | yuyu-tei.jp | JPY | Pokémon, Yu-Gi-Oh!, One Piece. |
| `cardrush`, `dorasuta` | | JPY | Pokémon only. |
| `magi`, `surugaya` | | JPY | Several games, no game filter (reports `game` ignored). |
| `ebay` | every eBay site | seller's own | Every eBay site in one search: any product, narrowed with `seller_country`, `category`, `attributes`. Japanese sellers: `seller_country: ["jp"]`; they list in USD and title in English (`charizard`, not `リザードン`). |
| `ebay_us`, `ebay_uk`, `ebay_de`, `ebay_fr`, `ebay_it`, `ebay_es` | | USD/GBP/EUR | **Sellers located in that country** (or the `seller_country` you name), at the seller's own price and currency. Free and fast: eBay's own search answers first; only when it fails does the store read eBay's page (often paid, about $0.004) and then a listing API whose rows lack bids, format, location and seller. Bounds are in the store's currency (USD on `ebay`). On eBay, `game` sets eBay's trading-card category and Game, `language` its Language, and `condition`, `format`, `seller` and one `seller_country` are applied by eBay. Rows carry bids, end time and buy-now on auctions, seller and feedback, shipping (absent when eBay calculates it), `country`, `details["eBay site"]` and `details["USD price"]`. One call returns each listing **once** across eBay stores; `price_converted` appears only on rows read from eBay's page. Open listings only. |
| `yahoo_auctions` | auctions.yahoo.co.jp | JPY | Auctions with bids and end times. |
| `mercari_jp`, `paypay_flea`, `rakuma` | | JPY | Japanese flea markets. Mercari now runs auctions too: a tile showing 現在 ¥ is an オークション商品, returned as `format: "auction"` with `price` the current bid (no bids or end time on the tile). |
| `bunjang`, `joongna`, `daangn` | | KRW | Korean marketplaces. |
| `catawiki` | catawiki.com | EUR | Auctions with bids and end times. |
| `todocoleccion` | todocoleccion.net | EUR | Spanish collectibles. |
| `vinted_fr`, `leboncoin` | | EUR | France. |
| `kleinanzeigen`, `willhaben`, `ricardo`, `tutti`, `anibis` | | EUR/CHF | Germany, Austria, Switzerland. |
| `marktplaats`, `2dehands`, `subito`, `wallapop`, `milanuncios` | | EUR | Netherlands, Belgium, Italy, Spain. |
| `gumtree`, `shpock`, `adverts_ie`, `locanto_gb` | | GBP/EUR | UK, Ireland. |
| `olx_pl`, `olx_pt`, `olx_ro`, `olx_bg`, `olx_ua`, `olx_br`, `allegro_lokalnie` | | local | OLX countries, Poland. |
| `blocket`, `finn`, `dba`, `tori` | | SEK/NOK/DKK/EUR | Nordics. |
| `aukro`, `bazos_cz`, `bazos_sk`, `sbazar`, `jofogas`, `njuskalo`, `bolha`, `skelbiu`, `kupujemprodajem` | | local | Central and Eastern Europe. |
| `locanto_de`, `locanto_fr`, `locanto_es`, `dubizzle_ae` | | EUR/AED | Thin for cards. |

Not working, do not use (each reports `failed`): `mercadolivre_br`, `mercadolibre_ar`,
`mercadolibre_mx`, `mercadolibre_cl`, `mercadolibre_co` (blocked), `coolstuffinc` (empty pages),
`sahibinden` (login wall), `locanto_it` (the site's TLS is broken).

## Sold prices (not in shopping_search)

shopping_search returns active listings only. For **Japanese sold prices**, fetch Yahoo Auctions'
closed search with `web_fetch` (free, no render): 
`https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=<query>&n=50` with `user_agent: "chrome"`,
and a `script` that reads the page's `__NEXT_DATA__` sale records (final price in JPY, bids, end
time, condition `NEW` / `USED20`-`USED60`, auction id). Deduplicate by auction id. eBay sold
prices are not available from any source mcpy has.

## Using it well

- eBay: `ebay` with filters (`seller_country`, `game`, `attributes`); ask `facets: true` once to learn a category's item specifics (Grade, Professional Grader, Set...).
- Pick the stores for the card and market: Japanese cards → `yahoo_auctions`, `mercari_jp`,
  `cardrush`, `yuyutei`, `dorasuta` with a Japanese query; European → `cardmarket`, `ebay`, `kleinanzeigen`, `vinted_fr`; US → `tcgplayer`, `ebay`.
- One currency (and one language) per call. Use `game` on card sites.
- Keep `max_products` low and `max_age` at its default: cached reads are free, and your cap is small.
- Page with `next_cursor` instead of raising `max_results`. A store that failed on its first page
  is not in the cursor: search it again without a cursor to retry.
- Read `marketplaces[]` before concluding "no listings": `failed` means the store was not read.
- `web_search` now runs on a cheap source first; use it to find price guides (PriceCharting,
  PSA) and then `web_fetch` the page.
