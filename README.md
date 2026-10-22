# toolshed

A self-hostable tools server for AI agents, running on Cloudflare Workers.
It exposes the same tools two ways:

- **MCP** at `/mcp` (streamable HTTP) for MCP clients
- **REST** at `/v1/*` (JSON) for other agents and services

Web tools fetch through a **fallback chain of providers**: a cheap direct
fetch first, a headless browser for JS-rendered pages, then paid scraping
services for blocked sites. Every call is **cached** in KV and **measured**
(provider, latency, cost, outcome) in Workers Analytics Engine.

Everything deployment-specific is configuration, so anyone can deploy their own copy.

## Tools

| MCP tool        | REST                       | What it does |
| --------------- | -------------------------- | ------------ |
| `web_fetch`     | `GET\|POST /v1/fetch`      | Page as clean markdown (or HTML), paginated |
| `web_grep`      | `GET\|POST /v1/grep`       | Regex search in a page, with context lines |
| `web_search`    | `GET\|POST /v1/search`     | Web search: titles, URLs, snippets |
| `web_providers` | `GET /v1/providers`        | Enabled providers in fallback order |

All fetch/search calls accept `provider` (force one provider instead of the
chain) and `fresh` (skip the cache).

```bash
# REST, POST with a JSON body
curl -s https://tools.example.com/v1/fetch \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"url":"https://example.com","max_length":5000}'

# REST, GET with query parameters (for agents that can only be given a URL)
curl -s "https://tools.example.com/v1/search?query=cloudflare+workers&limit=5&key=$TOKEN"
```

Responses report which provider served the page, whether it came from the
cache, and every provider attempt (`attempts`).

## Providers

| id           | Kind          | Needs | Notes |
| ------------ | ------------- | ----- | ----- |
| `cf_fetch`   | fetch         | nothing | `fetch()` from the Worker + Readability + Turndown. Asks for `text/markdown` first, which some sites serve to agents directly |
| `cf_browser` | fetch         | `CF_ACCOUNT_ID`, `CF_BROWSER_API_TOKEN` | Cloudflare Browser Run (headless Chrome) for JS-rendered pages |
| `firecrawl`  | fetch, search | `FIRECRAWL_API_KEY` | Firecrawl v2 scrape and search. `FIRECRAWL_API_URL` for self-hosted |
| `brightdata` | fetch, search | `BRIGHTDATA_API_KEY` + `BRIGHTDATA_UNLOCKER_ZONE` / `BRIGHTDATA_SERP_ZONE` | Web Unlocker for heavily protected sites; SERP API (Google) for search |

A provider is enabled only when its credentials are set; `web_providers`
shows what is active and what was skipped.

**How the chain decides.** A provider's result is used when it is a real page.
The chain moves to the next provider on network errors, timeouts, HTTP
401/403/429/5xx, bot-challenge pages, or near-empty content (a JS app shell).
A 404/410 is final: the chain does not pay a fallback to confirm it. Only
usable or final pages are cached; blocked pages never are.

**Adding a provider.** Implement `FetchProvider` or `SearchProvider`
(`src/providers/types.ts`), register its factory in
`src/providers/registry.ts`, and add its id to `FETCH_PROVIDERS` /
`SEARCH_PROVIDERS`. Tools never reference providers directly.

## Authentication

Requests to `/mcp` and `/v1/*` need a token from `AUTH_TOKENS`. A client may send it as:

1. `Authorization: Bearer <token>` (preferred)
2. `X-API-Key: <token>`
3. `?key=<token>` in the URL, for web agents that can only take a URL

URL keys end up in logs and browser history. Give URL-based clients their own
token so you can rotate it without touching the others. `AUTH_TOKENS` holds
several comma-separated tokens for exactly this.

With no tokens configured the server rejects everything (it fails closed).
`ALLOW_ANONYMOUS=true` disables auth, for local development only.

## Configuration

Non-secret settings are `vars` in `wrangler.jsonc`. Secrets are set with
`wrangler secret put NAME`.

| Name | Default | Purpose |
| ---- | ------- | ------- |
| `AUTH_TOKENS` (secret) | - | Comma-separated client tokens |
| `FETCH_PROVIDERS` | `cf_fetch,cf_browser,firecrawl,brightdata` | Fetch chain order |
| `SEARCH_PROVIDERS` | `firecrawl,brightdata` | Search chain order |
| `CACHE_TTL_SECONDS` | `3600` | Page cache TTL (min 60) |
| `SEARCH_CACHE_TTL_SECONDS` | `900` | Search cache TTL (min 60) |
| `FETCH_TIMEOUT_MS` | `20000` | Per-provider timeout |
| `MAX_RESPONSE_BYTES` | `5000000` | Largest body read from a provider |
| `USER_AGENT` | `toolshed/0.1` | UA for direct and browser fetches |
| `ALLOWED_HOSTNAMES` | - | Restrict accepted `Host` headers (set it on custom domains) |
| `CF_BROWSER_API_BASE` | Browser Run endpoint | Override the Browser Run API base (`{account}` is substituted) |
| `COST_*` | see `src/config.ts` | Per-call USD estimates used in telemetry |

Provider credentials are listed under [Providers](#providers).

## Deploy your own

```bash
npm install
cp .dev.vars.example .dev.vars   # local secrets, never committed
npm run dev                      # http://localhost:8787/mcp

npx wrangler secret put AUTH_TOKENS
npx wrangler secret put FIRECRAWL_API_KEY   # ...and any other provider secrets
npm run deploy
```

On first deploy, Wrangler creates the KV namespace and the Analytics Engine
dataset. To serve a custom domain, add a route and `ALLOWED_HOSTNAMES`. The
`lytl` environment in `wrangler.jsonc` is a complete example: it is the
maintainers' own deployment at `tools.ly.tl`, deployed with:

```bash
npx wrangler secret put AUTH_TOKENS --env lytl
npm run deploy -- --env lytl
```

## Telemetry

The server writes one data point per provider attempt (`blob1 = 'attempt'`)
and one per tool call (`blob1 = 'call'`). The column layout is documented in
`src/core/telemetry.ts`. Example, with the
[SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/):

```sql
SELECT blob3 AS provider, blob4 AS outcome, count() AS n,
       avg(double1) AS avg_ms, sum(double3) AS usd
FROM toolshed
WHERE blob1 = 'attempt' AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY provider, outcome ORDER BY n DESC
```

The same events also go to Workers Logs as structured JSON.

## Development

```bash
npm test          # vitest
npm run typecheck
npx wrangler deploy --dry-run   # bundle check
```

## License

Apache-2.0
