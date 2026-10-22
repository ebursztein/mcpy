# mcpy architecture

mcpy gives agents web tools (fetch, grep, search) through one SDK. The SDK
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

## Reliability

| Concern | Mechanism |
| --- | --- |
| Provider down or blocked | Fallback chain: next provider on error, 401/403/429/5xx, bot challenge, or near-empty page |
| Definitive answers | 404/410 stop the chain (no paid fallback to confirm a missing page) |
| Transient failures | Retry with exponential backoff and jitter on network errors, 408, 429, 5xx; honors `Retry-After` |
| Slow providers | Per-attempt timeout, capped by an overall deadline for the whole chain |
| Flapping providers | Circuit breaker: after N consecutive failures a provider is skipped for a cooldown (never when it is the last option) |
| Huge pages | Byte cap on every upstream body |
| LLM context | Hard caps on returned characters, pagination, grep with bounded context, short search snippets, `truncated` flags |
| Repeat requests | Cache keyed by normalized URL / query; only usable or definitive results are cached |

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

`MCPY_CLIENTS` maps names to keys (`name:key,...`). A key is accepted as
`Authorization: Bearer`, `X-API-Key`, or `?key=` (for URL-only web agents).
Each client has its own rate limit (Workers Rate Limiting binding) and shows
up by name in logs, traces and metrics. No keys configured means every
request is rejected.

## User agents

Requests use a `UserAgentProfile` enum (`mcpy`, `chrome_desktop`,
`chrome_mobile`, `safari_desktop`, `firefox_desktop`, `googlebot`). The honest
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
