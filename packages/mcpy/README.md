# mcpy

Web tools for AI agents (fetch, grep, search) behind one typed SDK.
Callers never deal with backends: mcpy picks the source, retries, falls
back, caches, and keeps responses small enough for an LLM's context.

```bash
npm install mcpy
```

## Use it

```ts
import { createMcpy, PaperSort, Recency, SearchMode, SearchType } from "mcpy";
import { arxiv, direct, firecrawl, firecrawlSearch, openAlex } from "mcpy/providers";

const mcpy = createMcpy({
  pages: [direct(), firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! })],
  search: [firecrawlSearch({ apiKey: process.env.FIRECRAWL_API_KEY! })],
  papers: [openAlex(), arxiv()],
});

const page = await mcpy.fetch({ url: "https://elie.net", max_chars: 5_000 });
page.content;      // markdown
page.next_offset;  // pass as offset to read the next part (absent at the end)
page.meta.cache;   // "hit" | "miss" | "bypass"

const hits = await mcpy.grep({ url: "https://elie.net", pattern: "secur(e|ity)" });         // RE2 syntax
const exact = await mcpy.grep({ url: "https://elie.net", pattern: "$5.00", literal: true });

const news = await mcpy.search({
  query: "cloudflare workers",
  type: SearchType.News,          // web, news, images, videos, shopping, jobs, places
  recency: Recency.Week,          // hour, day, week, month, year
  country: "us",
  sites: ["blog.cloudflare.com"],
  mode: SearchMode.Thorough,      // combine every capable source
});
news.results[0].sources;          // how many sources returned it

const papers = await mcpy.papers({ query: "diffusion models", sort: PaperSort.Citations, year_from: 2020, open_access: true });
papers.results[0];                // { title, authors, year, venue, citations, abstract, doi, url, pdf_url, ... }
```

Inputs and outputs are zod schemas (`FetchInputSchema`, `FetchResultSchema`,
...), exported for your own validation. Errors are always `McpyError` with a
`code` from the `ErrorCode` enum.

## Entry points

| Import | What |
| --- | --- |
| `mcpy` | `createMcpy`, schemas, enums, errors, caches |
| `mcpy/providers` | Backends: `direct`, `cloudflareBrowser`, `firecrawl`, `firecrawlSearch`, `brightData`, `brightDataSearch`, `openAlex`, `arxiv`, `semanticScholar` |
| `mcpy/telemetry` | OpenTelemetry-shaped spans and logs; sinks for console, OTLP, Analytics Engine, and an `@opentelemetry/api` bridge |
| `mcpy/client` | `McpyClient`: typed client for a hosted mcpy server, same API as the SDK |
| `mcpy/mcp` | `registerMcpyTools(server, api)`: mounts the tools on any MCP server |

## What happens on a call

1. Input validated (zod); URLs must be public http(s), and so must every
   redirect hop (hosted providers follow redirects on their side).
2. Cache lookup (in memory by default, Cloudflare KV with `KvCache`).
3. Providers tried in order. Each attempt has a timeout; the whole call has a
   deadline. Transient errors (network, 408, 429, 5xx) are retried with
   jittered backoff that honors `Retry-After`. A provider that keeps failing
   is skipped for a cooldown (circuit breaker).
4. Each result is judged: blocked pages, bot challenges and empty HTML
   shells move on to the next provider; 404/410, unsafe redirects and
   unsupported content types are final. Short text or JSON is fine as is.
5. HTML becomes markdown (mdream, main content isolated), output is
   paginated and capped, and the result is cached.

## Configure

```ts
createMcpy({
  pages, search,
  cache: new KvCache(env.CACHE),            // or MemoryCache, NoCache, your own Cache
  telemetry,                                 // see below
  limits: { attemptTimeoutMs: 20_000, deadlineMs: 45_000, maxResponseBytes: 5_000_000,
            pageTtlSeconds: 3_600, searchTtlSeconds: 900 },
  retry: { retries: 2, baseDelayMs: 250, maxDelayMs: 4_000 },
  breaker: { failureThreshold: 5, cooldownMs: 30_000 },
  userAgent: { default: UserAgentProfile.Default, custom: "mybot/1.0 (+https://example.com)" },
});
```

Every option is validated with zod and has a default.

## Telemetry

```ts
import { Telemetry, ConsoleSink, OtlpSink, OpenTelemetryBridgeSink } from "mcpy/telemetry";

const telemetry = new Telemetry([
  new ConsoleSink(),                                              // JSON log lines
  new OtlpSink({ endpoint: "https://otlp.example.com", resource: { "service.name": "my-agent" } }),
]);
const mcpy = createMcpy({ pages, telemetry }).with({ client: "billing-agent" });
// ... after the request:
await telemetry.flush();
```

Spans: `mcpy.operation` > `mcpy.attempt` (one per provider) > `http.client`
(one per try). Every span and log carries `client.name` and
`mcpy.request.id` when set with `.with()`.

## Write a provider

Implement `PageProvider` or `SearchProvider` from `mcpy/providers`. Make HTTP
calls through `call.http` (never `fetch`) so you get retries, timeouts,
redirect checks, size caps and spans for free, and parse JSON with a zod
schema via `call.http.json(request, schema, call.context)`. Throw
`ProviderFailure` with an `ErrorCode`; set `kind` on pages with
`contentKindOf(contentType)`; set `circuitBreaker: false` if your failures
describe the target rather than your own health. `mcpy/providers` also
exports `htmlToMarkdown`, `HttpMethod` and the HTTP types.

On a server, pass `defer` (e.g. `ctx.waitUntil`) via `mcpy.with({ defer })`
so cache writes happen after the response.

## License

Apache-2.0
