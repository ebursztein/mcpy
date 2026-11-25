# mcpy architecture

mcpy gives agents web tools (fetch, grep, search), scholarly paper search, shopping and crypto market data through one SDK. The SDK
hides which backend serves a request; the hosted server and the MCP endpoint
are thin layers on top of it.

## Layers

```
 MCP (/mcp)      REST (/v1/*)      your code
      \              |              /
       '---------- SDK: createMcpy() ----------'   public API: zod schemas in, zod schemas out
                         |
                       Engine                      cache, fallback chain, deadline,
                         |                         circuit breaker, context limits, telemetry
                  Provider adapters                one folder per backend
                         |
                Unified HTTP client                timeout, retry + backoff, Retry-After,
                         |                         size cap, user-agent profiles, zod-validated JSON
                      network
```

Rules, each enforced by tests where possible:

1. **Callers never see providers.** Public inputs have no provider field and
   public outputs carry no provider name. Provider ids appear only in
   telemetry, logs and the operator-only `/v1/admin/providers` endpoint.
2. **MCP and REST use the SDK only.** They import from `mcpy`, never from
   engine or provider modules.
3. **Providers make HTTP calls only through the unified HTTP client**, never
   `fetch` directly. Every JSON response is parsed with a zod schema.
4. **Everything is typed with zod.** Inputs, outputs, env config, provider
   responses and REST client responses. Categorical values are `z.enum`s
   with exported constants, never free strings.
5. **Modules stay under 300 lines.** A test fails the build otherwise.
6. **One folder per provider**: `providers/<name>/{index,schemas,...}.ts`.

## Shopping: services, sites, fetcher

`shopping_search` and `shopping_item` add a layer between the API and the engine:

```
MCP / REST -> Mcpy facade -> services/shopping -> sites/<site> -> engine.page() -> providers -> HttpClient
                              (input, merge,     (URLs, filters,  (cache, fallback,
                               reports, cursor)   page readers)    render, breaker)
```

- **Service** (`services/shopping/`): validates the input, asks each requested
  site for its search request, fetches it through the engine, hands the page
  back to the site's reader, normalizes the rows, applies the filters the site
  could not, interleaves sites and reports per site (`ok`, `empty`, `failed`
  with `blocked`/`redesigned`/`redirected`/`truncated`/`timeout`/`upstream_failed`,
  `ignored` request parts, and `cost_usd` from a per-site part of the call's
  `SpendMeter`). A failed site never fails the call.
- **Title match** (`title-match.ts`): sites flagged `matchesLoosely` (any
  word, descriptions, n-grams) have rows whose title lacks the query dropped
  (`title_match` auto = all_words); the report counts them as `unmatched`.
- **One listing, one row** (`merge.ts`): sites in one `listingPool` (the eBay
  sites) show the same listing under the same id, priced per site. The merge
  keeps the row not marked `price_converted` (eBay's price for a listing from
  abroad), and counts dropped duplicates as consumed for the cursor.
- **Sites** (`sites/<region>/`): one `ShoppingSite` per marketplace key
  (`ebay_de`, `cardmarket`, `leboncoin`...). A site knows its URLs, which
  filters its URL applies, and how to read its result page; it never fetches.
  Card marketplaces return product links; the service opens up to
  `max_products` product pages and every seller's offer becomes a listing.
  Shared readers: `sites/readers/` (embedded JSON, JSON-LD, HTML cards, values).
- **Normalize** (`sites/normalize.ts`): a row is a listing only if its URL is
  on the site's host(s) with a listing id and a title; every other field is
  validated and dropped on its own if bad, never the row.
- **Fetcher**: the engine's page path, unchanged: the universal cache
  (`max_age`), site routes, fallback chain, render providers. Sites prefer
  their own JSON APIs and embedded state (free) over rendering (paid).
- **Feeds** (first): a site may declare a `feed`, a free source tried
  before its search page (the eBay stores: eBay's Browse search, through
  PicClick, with the store's country and currency). Any failure hands over
  to the page; an empty answer stands. `searchSource` in `fetch-site.ts`
  runs feed, page, listing API in that order.
- **Generic filters**: every listing filter (`condition`, `format`,
  `language`, `game`, `seller_country`, `seller`, `category`, `attributes`)
  reaches the site in `SiteQuery`; the site claims what it applied in
  `SiteRequest.applies`, and `filters.ts` filters the rest on the rows or
  reports it in `ignored` (category and attributes exist only on the site's
  side). A site may return `facets` (categories, item specifics with
  counts), reported when the caller asks.
- **Listing APIs** (last resort): a site may declare an `api` read (today the
  six eBay sites). When every page source failed for its search page
  (`blocked`, `timeout`, `upstream_failed`; not `redesigned` or `redirected`,
  and not over budget), the service asks the engine's listing sources
  (`createMcpy({ listings })`, the server's `LISTING_PROVIDERS`) for the same
  market, sort, bounds and page. Their rows are thinner than the page's, so
  the page reader stays the main path. Contract: `providers/listing-types.ts`.
- **Paging**: `next_cursor` holds one position per site (search page or the
  site's own token, rows already returned, product pages already opened, retries).
  Continuation calls reread the cached page (up to the page cache TTL, 1 h by
  default), so offsets point at the same rows; a transient failure past page 1
  keeps the site's place for up to two retries.
- **Bounds**: 4 sites fetched at once, at most 20 product pages per call, a 90 s
  whole-call deadline (a site still running is reported as timed out).
- Every store's chosen path and live verdict is recorded in `docs/shopping/`.

## Crypto: market and coin days

`crypto_market` (`mcpy.cryptoMarket`, `/v1/crypto/market`) lists coins as they are now with the
whole-market totals; `crypto_coin` (`mcpy.cryptoCoin`, `/v1/crypto/coin`) gives a few coins day
by day. Contract: `schemas-crypto.ts`; sources: `providers/crypto-types.ts`; service:
`services/crypto/`.

- **Sources** (all free):
  Coin Metrics' community API for complete days (network for BTC, BCH, LTC, DOGE, ZEC, XMR, ETC,
  DASH; prices for more), CoinGecko (`COINGECKO_API_KEY`, a demo key shared with deepmine: 30
  calls a minute) for totals, prices of every coin and a year of daily closes, miningpoolstats
  for the live network of ~490 mined coins (its data file only answers with the `t` its homepage
  links to, so the homepage is read first; its whole table is kept 5 minutes and shared by every
  call), Kaspa's public API for KAS's complete days (15-minute hashrate samples, averaged per day;
  the subsidy read off coinbases), Dash Core Group's Insight explorer for DASH's coinbase payout
  per block, mempool.space (BTC) and litecoinspace.org (LTC) for a complete day's difficulty at its
  last block (each coin's whole retarget history, one call: the last retarget timed before the next
  UTC midnight). `CRYPTO_PROVIDERS` default: `coinmetrics,kaspa,dash,mempool,coingecko,miningpoolstats`.
- **Merge**: every capable source is asked at once, each through its own chain; answers are
  merged field by field, the first source in configured order with a value winning. One source
  failing never fails the call while another answered.
- **Days**: each is `complete` (the UTC day is over; final) or `live` (today, with `as_of`).
  A complete day's hashrate comes from its own blocks; a live one is the network's estimate.
  Callers sum complete days only. Two volumes never share a name: `volume_24h_usd` is trading volume
  across all tracked markets (complete and live days alike), `reported_spot_volume_usd` the spot
  volume exchanges report (complete days), counted differently and several times lower.
- **One name per measure**: `schemas-crypto.ts` defines a coin's facts and figures once; a market
  row and a live day carry exactly the same figures (built by one function), and a complete day
  uses the same names wherever the measure is the same. A test fails if the two tools drift.
- **Miners and hashprice** (`rules.ts`): what miners receive is known per coin (carried over
  from deepmine's registry: ZEC 80% of the subsidy and 40% of fees since NU7, DASH a quarter of
  each block's coinbase payout and no usable fee figure). Coins without a rule get no miner fields and no
  hashprice, never a guess. Hashprice is USD a day per H/s; live days count new coins only.
- **Block figures come from data** (`issuance.ts`, the kaspa and dash sources), never from a
  schedule or constant in `rules.ts`. A reward is a step function, so a window is read with few
  requests (`providers/step-fill.ts`): two equal readings settle every point between them. A source's block time target is reported only when the measured block time is
  within 2× of it: a stale one (ZEC's 75 s after NU7's 25 s) is left out. Where no live source
  states a coin's issuance (ZEC), it is the latest complete day's coins per block × 86,400 ÷ the
  live block time.
- **Bounds**: 40 day rows a call (coins × days; `from`/`to` for longer histories) and 40 market
  coins: a complete day with every figure at full precision is about 1,100 characters, a
  full market row about 1,060, so a full answer stays under the 50,000-character ceiling. Every answer is cached at least 5 minutes, whatever `max_age` says; a window ended two
  days ago is kept a day.
- **Tracing**: the usage log writes one `crypto_coin` row per coin and kind of day
  (`store` = "ZEC complete") with the source behind it; every result's `meta.call_id` is its log
  id, so a caller can have an admin look a figure's source up.

## Reliability

| Concern | Mechanism |
| --- | --- |
| Provider down or blocked | Fallback chain: next provider on error, HTTP 401/403/429/5xx from the target, bot challenge (judged on page title, challenge markup on small pages, challenge wording on tiny pages), or an empty HTML shell |
| Sites that block cheap providers | Site routes: once a later page provider serves a site (hostname + format), the next fetch starts with it, so a blocked direct fetch or browser attempt is not paid for on every call. The providers it skips move to the end of the chain, never out of it. Routes live in the cache for `siteRouteTtlSeconds` (default 15 minutes), then the cheap providers get another chance |
| Definitive answers | 404/405/410 stop the chain; so does an API's own refusal (a 401/403 whose body is a small JSON value with no bot-wall markers, e.g. Kryptex's `{"detail":"You do not have permission..."}`), returned with its status and body; so do an unsafe target and an unsupported content type (no paid fallback) |
| Thin but real pages | Short text, JSON or markdown is served as is. A short HTML page escalates; if no provider does better, the best one is returned and not cached |
| Transient failures | Retry with exponential backoff and jitter on network errors, 408, 429, 5xx; honors `Retry-After`; programming errors are never retried |
| Slow providers | Per-attempt timeout enforced by the engine (even if a provider ignores its abort signal), capped by an overall deadline |
| Flapping providers | Circuit breaker counting only thrown provider failures, never verdicts about the target page. Providers whose failures reflect the target (direct fetch) opt out. Skipped for a cooldown; never when every provider is open |
| Unsafe targets (SSRF) | Only public http(s) URLs. Redirects are followed by hand and every hop is checked. Hosted providers (Firecrawl, Bright Data, Browser Run) follow redirects on their side, outside this guard |
| Huge or binary pages | Content type checked before download; byte cap on every upstream body |
| Grep patterns | RE2 (re2js): linear time, so no pattern can stall the server; `literal` mode for plain text |
| Large pages | Fetch `script`: the caller's JavaScript module runs on the whole page and only its JSON result is returned (still paginated). The server loads each script as its own module with the Worker Loader binding (Workers cannot eval a string), keyed by the script's hash so a warm isolate is reused. Pages longer than one call carry a `tip` pointing at it |
| Pages read in parts | A page longer than one part is also stored under its own version key (a hash of the copy), written before the first part returns; later parts pass `version` and read exactly that copy. The shared cache entry cannot promise this: it is written after the response, KV may serve an older copy for a while, and another call can replace it. A part whose copy is gone fails with `version_expired` |
| LLM context | Hard caps on returned characters (50,000 per call), pagination, grep with bounded context and windowed long lines, short search snippets, `truncated` flags |
| Search coverage | Search providers declare capabilities (types, recency, site filters, depth); requests go only to providers that can honor them. Country, language and device are hints. `thorough` mode asks every capable provider in parallel and merges with reciprocal rank fusion, deduplicating by normalized URL |
| JavaScript pages | `render: true` sends a fetch only to providers that run a real browser (Cloudflare Browser Rendering through its Workers binding, then Firecrawl); `wait_ms` gives the page time to finish. Without it, a page that is a script shell but long enough to pass as content is served as is: detection cannot tell, so the caller asks |
| Requests beyond a GET | `method`/`body`/`headers` go only to providers that declare they can send them (`PageCapabilities`); a POST reaches only a direct request, never a paid fallback. A caller's POST is retried only after 408, 425 or 429, never after a 5xx or a lost connection, and 301/302/303 turn it into a GET without its body. Caller headers cannot set `Host`, `Content-Length` or connection headers |
| Cost estimates | Providers estimate per request where the bill depends on it (Firecrawl search: 2 credits per 10 results), so caps see what a call really costs |
| Repeat requests | Cache keyed by normalized URL / query, storing the page as fetched (scripts run on it afterwards, so a new script never refetches); every call (fetch, grep, search, papers) says how old an answer it accepts with one shared `max_age` field, 0 skipping the cache; written after the response when the host offers `defer` (Workers `waitUntil`); empty search results kept 60 s only |

## Observability

The SDK emits through a `Telemetry` interface modeled on OpenTelemetry: spans
(`mcpy.fetch`, `mcpy.attempt`, `http.client`), counters/histograms, and
structured log records with OTel semantic attribute names. Adapters:

- `OtlpExporter`: OTLP/HTTP JSON traces and logs to any collector
  (Cloudflare Traces, Grafana, Honeycomb, ...), flushed after the response.
- `AnalyticsEngineSink`: one data point per call/attempt for cheap SQL metrics.
- `ConsoleLogger`: JSON lines (Workers Logs picks these up).
- `OpenTelemetryBridge`: forwards to `@opentelemetry/api` when the host app
  already has an OTel SDK registered (Node).

Every record carries `request.id` and `client.name` (the name bound to the API
key that made the call).

## Clients and auth

`MCPY_CLIENTS` maps names to keys (`name:key[:admin]`; keys may contain ":").
A key is accepted as `Authorization: Bearer`, `X-API-Key`, or `?key=` (for
URL-only web agents). Each client has its own rate limit (Workers Rate
Limiting binding) and shows up by name in logs, traces and metrics. Failed
authentications are rate-limited per client IP. No keys configured means
every request is rejected. Cloudflare invocation logs are off because they
record full URLs, `?key=` included; mcpy's own logs never contain queries.
Request ids are always generated server-side.

Each client can also have a daily spending cap (`DAILY_BUDGET_USD`,
overridden per client by `CLIENT_DAILY_BUDGETS_USD`). The SDK takes a
`SpendLimit` in its call context: before an operation's first paid attempt
it asks the limit once, and over the cap it skips paid providers (free ones
and the cache still answer; if nothing does, `budget_exceeded`). Every
operation reports what its attempts cost, failed ones included. The server's
limit keeps each client's total for the UTC day in its own Durable Object
(`ClientBudget`). Costs are the providers' per-call estimates.

Usage: the server wraps the SDK it hands each request (usage/recorder.ts)
so every call yields log rows from its input and result: tool, query (URL or
search text), the other args as JSON (headers, body, script and cursor are
never logged), domain, store (one row per store for shopping_search, with
that store's cost), status, cache hit, attempts, duration and cost. The cost
comes through a spend limit wrapping the client's own, so failed calls count
too. Rows are written after the response to one `UsageLog` Durable Object
(one SQLite table for every client, 30 days); the `usage` / `usage_log`
tools and `/v1/usage` routes are SQL over it. A client sees only its own
rows; admins may ask for one client or all. The backend that served a call
comes from the SDK's `onServed` call-context hook (per store for shopping)
and is stored as an opaque number; only admins are shown its name.

Dashboard data: the admin-only `/v1/admin/dashboard` gives every client's
summary, the client x tool and day x tool stacks (usage/stacks.ts) and today's
spend per cap. The pages live elsewhere: the maintainers' dashboard (dash.ly.tl,
its own repository, behind Cloudflare Access) reads this route and
`/v1/usage/log` over a service binding with an admin key. This server serves
no pages and no static assets (removed 2026-11-25), and the lytl deployment
answers on tools.ly.tl only (`workers_dev` and `preview_urls` off). Page
attempt spans also carry the target host, so telemetry has cost per domain too.

Owner alerts: the call context can also carry an `onQuota` sink. The chain
calls it when a paid provider fails with 402 (`out_of_credits`) or 429
(`rate_limited`); the alert names the provider, so it is for the host, never
for callers. The server's sink (`apps/server/src/alerts.ts`) pushes to
Pushover once per provider and kind per cooldown. The budget pushes once
when an add moves a client's day total past its warning line
(`CAP_WARNING_PERCENT` of the cap) and once when it passes the cap (the
budget object returns the exact total each add replaced, so float sums
cannot fire either twice).

## User agents

Requests use a `UserAgentProfile` enum (`mcpy`, `chrome`,
`mobile`, `safari`, `firefox`, `googlebot`). The honest
`mcpy` profile is the default. Callers may choose a profile per call; the
engine can also retry a blocked direct fetch with a browser profile before
paying for the next provider.

## Tests

| Suite | What | Runs |
| --- | --- | --- |
| unit | every module with stubs | always |
| regression | one test per bug found in production or review | always |
| contract | provider adapters against recorded fixtures, validated by zod | always |
| structure | 300-line limit, no provider imports in MCP/REST, no raw `fetch` in providers | always |
| perf | latency budgets (cache hit, extraction) and response-size budgets | always |
| e2e | real Worker in workerd, MCP + REST, against elie.net | `npm run test:e2e` |
| live | real provider APIs | when provider keys are set |
