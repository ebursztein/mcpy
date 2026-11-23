# Shopping stores: Japan and Korea (asia)

Probed 2026-11-23 through the deployed mcpy (`scripts/probe-page.mjs`, Cloudflare IPs) and
verified with `scripts/live-shopping.ts` (named query, newest-first with a 5000 floor, nonsense
query `qzxjvwk glurak zzqv`). Test queries: リザードン (Japan), 리자몽 (Korea). Every site asks the
site for on-sale rows only.

| key | path chosen | live result | fields available | status | if not working |
| --- | --- | --- | --- | --- | --- |
| yahoo_auctions | embedded JSON (`__NEXT_DATA__`), no render; now n=100 a page | named: 23 rows (of 100, PayPay Flea rows dropped); floor: applied by site, ok; nonsense: empty | price, format, bids, ends_at, buy_now, free shipping, condition, seller + rating, promoted, image | working | - |
| paypay_flea | embedded JSON (`__NEXT_DATA__` searchState.search.result.items), no render | named: 100 rows; floor: applied by site, ok; nonsense: empty (HTTP 404 + `retriedWithVectorSearch`) | price, condition (+ site grade label), status, posted_at (openTime, +09:00), seller id + rating count/percent, image, category, brand, likes | working | - |
| mercari_jp | HTML of the rendered page (`render: true`, `country: "jp"`, 10 s wait, 1 credit/search) | named: 119 rows, yen; floor: applied by site, ok; nonsense: empty | url (item/m... and shops/product/...), title, price in JPY as the tile states it, auction (現在 ¥ = current bid), image | working | The unrendered page is an app shell (no rows), and the page's API `api.mercari.jp/v2/entities:search` answers 401 without a browser-signed DPoP proof (mcpy does not forge one), so each search costs a render. Rendered outside Japan the tiles show converted prices (US$); rendered from Japan with a 4 s wait they were still skeletons. No posted date, condition or seller on the tile. |
| rakuma | HTML cards (server-rendered, no JSON/JSON-LD with rows), no render | named: 40 rows; floor: applied by site, ok; nonsense: empty (fuzzy filler detected) | price + currency, status (SOLD OUT ribbon), image, brand, seller type, item number, price-reduced badge | working | - |
| joongna | embedded JSON (Next flight data: dehydrated `postSearchProduct` result), no render | named: 50 rows; floor: applied by site, ok; nonsense: empty (`items: []`) | price, free shipping (parcelFee), posted_at (sortDate = last bump, +09:00), location, status, likes, chats, Joongna Pay, certified seller, image; wanted from title | working | - |
| bunjang | API (`api.bunjang.co.kr/api/search/v8/web/search`, GET, public), no render; pages by the API's own cursor (`pagesByCursor`) | named: 53 rows; floor: applied by site, ok; page 2 via cursor: 54 rows, no overlap, older, floor ok; nonsense: empty (`SEARCH_EMPTY`) | price, status, posted_at (updatedAt, UTC), promoted (paid placement), likes, chats, Bunjang Care, shop id, image; wanted from title | working | The old `/api/1/find_v2.json` is 404. No page-number paging: `nextCursor` goes back as `&cursor=`. |
| daangn | embedded JSON (`window.__remixContext` loaderData buySellArticles), no render | named: 286 rows; floor: applied by site, ok; sort: ignored (site has no sort on search); nonsense: empty (semantic filler detected) | price, description, status, posted_at (createdAt), bumped at, region name, image, instant buy; wanted from title | working | Results are local to the region Daangn picks for the fetching IP. One page holds every row (~280); no paging. |

Notes that apply to several sites:

- Rakuma (n-gram), Daangn (semantic) and PayPay Flea (vector retry) answer a query that matches
  nothing with unrelated rows. PayPay Flea flags it itself; for Rakuma and Daangn a page where no
  row states any query word is read as empty (`sites/asia/common.ts` `noLiteralMatch`). It never
  filters rows from a real result page.
- Korean buyer posts (삽니다, 구합니다, 구해요, 구매합니다, 매입합니다, a leading 구매)/매입)/[구함] tag)
  are kept and marked `format: wanted`; the sites have no field for it.
- Newest-first: Yahoo, PayPay Flea (新着順, the order listings last surfaced), Mercari, Rakuma,
  Joongna and Bunjang sort on the site. Daangn cannot.
- Yahoo Auctions: no URL parameter excludes only PayPay Flea rows (`fixed=2` drops every
  fixed-price row); newest-first pages were ~70% flea rows at n=50, so the page size is now 100.

## Next steps

- mercari_jp: each search costs one render; revisit if Mercari's search API becomes callable
  without a browser-signed DPoP proof.
- daangn: results depend on the fetching IP's region; a region parameter (`in=<region>-<id>`)
  could be exposed if callers need nationwide or a chosen area.
