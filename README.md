# mcpy

Web tools for AI agents (fetch, grep, search), as:

- **an SDK** on npm: [`mcpy`](packages/mcpy), usable from any TypeScript project
- **a hosted server** on Cloudflare Workers: [`apps/server`](apps/server), exposing the
  same tools over MCP (`/mcp`) and REST (`/v1/*`), built only on the SDK

Callers never see which backend served a request. Under the hood: a fallback
chain of providers (direct fetch, Cloudflare Browser Run, Firecrawl, Bright
Data), retries with backoff, per-attempt timeouts and an overall deadline, a
circuit breaker, caching, context-size limits, and OpenTelemetry-shaped
traces and structured logs tagged with the calling client's name.

> mcpy used to be a local single-binary MCP server. That version is archived
> at [ebursztein/mcpy-legacy](https://github.com/ebursztein/mcpy-legacy).

Design and rules: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tools

| MCP tool | REST | Does |
| --- | --- | --- |
| `web_fetch` | `GET\|POST /v1/fetch` | Page as markdown (or HTML), paginated |
| `web_grep` | `GET\|POST /v1/grep` | Regex search in a page, with context lines |
| `web_search` | `GET\|POST /v1/search` | Web search: titles, URLs, snippets |

Operators also get `GET /v1/admin/providers` (admin clients only).

```bash
curl -s https://tools.example.com/v1/fetch \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"url":"https://elie.net","max_length":5000}'

# URL-only agents can pass everything as query parameters:
curl -s "https://tools.example.com/v1/search?query=cloudflare&limit=5&key=$KEY"
```

## Run your own server

```bash
npm install
cp apps/server/.dev.vars.example apps/server/.dev.vars   # local secrets, never committed
npm run dev                                              # http://localhost:8787

npx wrangler secret put MCPY_CLIENTS -c apps/server/wrangler.jsonc   # name:key[:admin],...
npx wrangler secret put FIRECRAWL_API_KEY -c apps/server/wrangler.jsonc
npm run deploy
```

Wrangler creates the KV namespace (cache), Analytics Engine dataset
(metrics) and rate limiter on first deploy. The `lytl` environment in
`apps/server/wrangler.jsonc` is the maintainers' deployment at
`tools.ly.tl`, a complete custom-domain example
(`npm run deploy -- --env lytl`).

### Clients and keys

`MCPY_CLIENTS` lists `name:key[:admin]` entries (keys 24+ characters). A key
is accepted as `Authorization: Bearer`, `X-API-Key`, or `?key=` for web
agents that can only be given a URL (give those their own key: URLs end up
in logs). Each client is rate-limited separately and named in every log
line, span and metric. With no clients configured, everything is rejected.

### Configuration

| Var | Default | Purpose |
| --- | --- | --- |
| `MCPY_CLIENTS` (secret) | - | API clients |
| `PAGE_PROVIDERS` | `direct,cloudflare_browser,firecrawl,brightdata` | Page fallback order |
| `SEARCH_PROVIDERS` | `firecrawl,brightdata` | Search fallback order |
| `ATTEMPT_TIMEOUT_MS` / `DEADLINE_MS` | `20000` / `45000` | Per attempt / per call |
| `RETRIES` | `2` | Retries per upstream request |
| `MAX_RESPONSE_BYTES` | `5000000` | Largest upstream body |
| `PAGE_CACHE_TTL_SECONDS` / `SEARCH_CACHE_TTL_SECONDS` | `3600` / `900` | Cache TTLs |
| `DEFAULT_USER_AGENT` | `mcpy` | `mcpy`, `chrome_desktop`, `chrome_mobile`, `safari_desktop`, `firefox_desktop`, `googlebot` |
| `USER_AGENT_STRING` | - | Replace the `mcpy` UA string |
| `ALLOWED_HOSTNAMES` | - | Accepted Host headers (set on custom domains) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` | - | Export traces + logs (OTLP/HTTP JSON) |
| `OTEL_SERVICE_NAME` / `DEPLOYMENT_ENV` | `mcpy` / `production` | Resource attributes |
| `CF_ACCOUNT_ID`, `CF_BROWSER_API_TOKEN` | - | Cloudflare Browser Run |
| `FIRECRAWL_API_KEY`, `FIRECRAWL_API_URL` | - | Firecrawl (URL for self-hosted) |
| `BRIGHTDATA_API_KEY`, `BRIGHTDATA_UNLOCKER_ZONE`, `BRIGHTDATA_SERP_ZONE` | - | Bright Data |

Everything is validated with zod at startup; a bad value fails closed with a
clear log line. A provider without credentials is skipped.

### Observability

- **Logs**: one structured JSON line per operation in Workers Logs, with
  `client.name`, `mcpy.request.id`, trace ids, cache status, cost.
- **Traces**: set `OTEL_EXPORTER_OTLP_ENDPOINT` to send spans and logs to
  any OTLP collector (Cloudflare Traces, Grafana, Honeycomb, ...). Incoming
  `traceparent` headers are honored.
- **Metrics**: Analytics Engine, one row per operation and provider attempt.
  Column layout in `packages/mcpy/src/telemetry/sinks/analytics.ts`.

```sql
SELECT blob7 AS client, blob3 AS provider, blob4 AS outcome, count() AS n,
       avg(double1) AS avg_ms, sum(double3) AS usd
FROM mcpy WHERE blob1 = 'mcpy.attempt' AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY client, provider, outcome ORDER BY n DESC
```

## Develop

```bash
npm test            # unit, contract, regression, structure, perf
npm run test:e2e    # real Worker in workerd, MCP + REST against elie.net
npm run test:live   # real provider APIs (keys from apps/server/.dev.vars)
npm run typecheck
```

## License

Apache-2.0
