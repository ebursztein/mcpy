# mcpy - MCP Tool Server Implementation Plan

## Context

Build mcpy from scratch: a Bun-powered HTTP server that exposes MCP tools to AI clients (Claude Desktop, Cursor, VS Code) with a Svelte 5 web UI for monitoring and configuration. The repo currently only has .gitignore, LICENSE, and README.md.

The server reimplements the most useful MCP tools in one unified server with a clean web dashboard for configuration, API key management, and live monitoring of tool invocations.

---

## Directory Structure

```
mcpy/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                  # Bun.serve() entry point, routing
│   ├── mcp.ts                    # McpServer setup + transport
│   ├── events.ts                 # Event pub/sub (SSE to UI)
│   ├── settings.ts               # Settings manager (JSON on disk)
│   ├── api.ts                    # REST API handlers (/api/*)
│   ├── types.ts                  # Shared types
│   ├── tools/
│   │   ├── index.ts              # Auto-loader: scan dirs, register tools
│   │   ├── base.ts               # ToolDefinition interface
│   │   ├── web/
│   │   │   ├── web_fetch.ts      # Webpage fetch + Readability extraction
│   │   │   ├── http_headers.ts   # HTTP header inspection
│   │   │   ├── web_search.ts     # Perplexity API search
│   │   │   └── web_crawl.ts      # Firecrawl integration
│   │   ├── database/
│   │   │   ├── mysql_query.ts    # MySQL query execution
│   │   │   └── postgres_query.ts # PostgreSQL query execution
│   │   ├── developer/
│   │   │   ├── code_search.ts    # ripgrep-based code search
│   │   │   ├── npm_info.ts       # npm registry lookup
│   │   │   └── pypi_info.ts      # PyPI registry lookup
│   │   └── agent/
│   │       ├── todo_list.ts      # Persistent todo list (CRUD)
│   │       └── memory.ts         # Persistent key-value memory
│   └── data/                     # Runtime data (gitignored)
│       ├── settings.json
│       ├── todos.json
│       └── memory.json
├── ui/                           # SvelteKit 5 SPA
│   ├── package.json
│   ├── svelte.config.js
│   ├── vite.config.ts
│   ├── src/
│   │   ├── app.html
│   │   ├── app.css               # @import "tailwindcss"; @plugin "daisyui";
│   │   ├── lib/
│   │   │   ├── api.ts            # Fetch wrapper for /api/*
│   │   │   ├── events.ts         # SSE EventSource client
│   │   │   └── components/
│   │   │       ├── Sidebar.svelte
│   │   │       ├── StatsBar.svelte       # Stat cards row (invocations, success rate, etc.)
│   │   │       ├── SessionList.svelte    # Active MCP client sessions
│   │   │       ├── ToolHealthGrid.svelte # Tool health overview cards
│   │   │       ├── EventLog.svelte       # Live terminal-style activity log
│   │   │       ├── ToolCard.svelte       # Tool toggle card for /tools page
│   │   │       └── SettingsField.svelte  # Reusable settings input
│   │   └── routes/
│   │       ├── +layout.svelte    # Drawer sidebar layout
│   │       ├── +layout.js        # ssr=false, prerender=false
│   │       ├── +page.svelte      # Dashboard (live event log)
│   │       ├── tools/+page.svelte    # Tool management (toggles by category)
│   │       └── settings/+page.svelte # API keys + DB connections
│   └── static/
└── dist/                         # Built output (gitignored)
```

---

## Implementation Steps

### Step 1: Project scaffolding
- Create `package.json` with dependencies: `@modelcontextprotocol/sdk`, `zod`, `@mozilla/readability`, `linkedom`, `mysql2`, `pg`, `concurrently`
- Create `tsconfig.json` (ESNext, bundler resolution, bun-types)
- Create `.env.example` with PORT, PERPLEXITY_API_KEY, FIRECRAWL_API_KEY
- Update `.gitignore` to add `src/data/`, `dist/`, `ui/build/`, `ui/.svelte-kit/`
- Run `bun install`

### Step 2: Backend core - types, settings, events
- `src/types.ts` - Shared interfaces (McpEvent, Settings, ToolInfo, SessionInfo, ToolStats)
- `src/settings.ts` - Read/write `src/data/settings.json`, env var fallback for API keys, redaction for GET responses
- `src/events.ts` - EventBus class with emit/subscribe/recentEvents (last 200), generates SSE-formatted streams. Also tracks aggregate stats: per-tool invocation counts, success/error counts, last invocation time, average duration. Tracks active MCP sessions (connected clients).

### Step 3: Tool framework
- `src/tools/base.ts` - `ToolDefinition` interface: name, category, title, description, inputSchema (zod), handler, requiredSettings
- `src/tools/index.ts` - Auto-loader using `Bun.Glob` to scan `*/**.ts` in tools dir, imports each, checks enabled state from settings, calls `server.registerTool()` with event-emitting wrapper

### Step 4: MCP server + HTTP entry point
- `src/mcp.ts` - `createMcpServer()` factory: creates McpServer, calls auto-loader, returns server instance
- `src/api.ts` - REST handlers: GET/POST /api/tools, GET/POST /api/settings, GET /api/events (SSE), GET /api/stats (aggregate tool stats), GET /api/sessions (active MCP client sessions)
- `src/index.ts` - `Bun.serve()` on port 3001:
  - POST/GET/DELETE `/mcp` -> `WebStandardStreamableHTTPServerTransport.handleRequest()`
  - Session management: Map<sessionId, {transport, clientInfo, connectedAt}>. Create new on initialize requests. Emit session_connect/session_disconnect events. Track clientInfo from initialize params (clientInfo.name).
  - `/api/*` -> api handlers
  - `/*` -> static file serving from `ui/build/` with SPA fallback

### Step 5: Agent tools (no external deps, easy to test first)
- `todo_list.ts` - Actions: list, add, update, remove, clear. JSON file persistence at `src/data/todos.json`
- `memory.ts` - Actions: get, set, delete, list, search. JSON file persistence at `src/data/memory.json`. Search does case-insensitive substring match on keys and values.

### Step 6: Developer tools
- `code_search.ts` - Spawns `rg` (ripgrep) via `Bun.spawn()`. Params: pattern, path, file_glob, case_sensitive, max_results, context_lines
- `npm_info.ts` - Fetches `registry.npmjs.org/{name}` + downloads API. Returns version, description, deps, license
- `pypi_info.ts` - Fetches `pypi.org/pypi/{name}/json`. Returns version, description, requires_dist, license

### Step 7: Web tools
- `web_fetch.ts` - Fetches URL, uses linkedom + @mozilla/readability for `content` mode. Supports `raw_html` mode. Pagination via `start_index`/`max_length` (default 5000 chars). Returns metadata (title, byline, hasMore)
- `http_headers.ts` - HEAD/GET request, returns status + headers object + redirect chain
- `web_search.ts` - POST to `api.perplexity.ai/chat/completions` with model `sonar`. Requires `apiKeys.perplexity`
- `web_crawl.ts` - POST to Firecrawl API (scrape/crawl/map modes). Requires `apiKeys.firecrawl`

### Step 8: Database tools
- `mysql_query.ts` - Uses `mysql2/promise`. Connection from settings, parameterized queries, readonly mode, timeout, row_limit (default 100)
- `postgres_query.ts` - Uses `pg`. Same pattern. SET TRANSACTION READ ONLY for readonly mode.

### Step 9: SvelteKit UI scaffolding
- Scaffold `ui/` with package.json, svelte.config.js (adapter-static, fallback: 'index.html'), vite.config.ts (@tailwindcss/vite, proxy /api and /mcp to :3001)
- app.css with `@import "tailwindcss"; @plugin "daisyui";`
- app.html base template
- +layout.js with `ssr = false, prerender = false`
- Run `cd ui && npm install`

### Step 10: UI - Layout + Dashboard
- `+layout.svelte` - DaisyUI drawer sidebar (Dashboard, Tools, Settings links), responsive
- `lib/events.ts` - SSE client using EventSource connected to `/api/events`
- `lib/api.ts` - Fetch wrappers for tools, settings, stats, sessions APIs

**Dashboard (`+page.svelte`)** - The main page with 4 sections:

1. **Stats bar** (top) - DaisyUI stat cards in a row:
   - Total invocations (all time counter)
   - Success rate (percentage with color: green >95%, yellow >80%, red otherwise)
   - Active sessions (number of connected MCP clients)
   - Tools enabled (X of Y)

2. **Active sessions panel** - Shows connected MCP clients:
   - Session ID (truncated), client name (Claude Desktop / Cursor / etc if available from initialize params), connected since timestamp
   - Green dot for active, auto-removes on disconnect
   - Polls `/api/sessions` or updates via SSE session events

3. **Tool health grid** - Card grid showing each tool at a glance:
   - Tool name + category color badge
   - Enabled/disabled indicator
   - Last invoked timestamp (or "never")
   - Mini success/error ratio (e.g., "47/2" or a small bar)
   - Warning icon if required API key is missing
   - Sorted by most recently used

4. **Live activity log** (bottom, takes most vertical space) - Terminal-style scrolling feed:
   - Each event: timestamp, category badge, tool name, input summary (truncated), duration, status icon
   - Color-coded: green for success, red for error
   - Pause/resume and clear buttons
   - Auto-scrolls to bottom, pauses auto-scroll when user scrolls up

**Components:**
- `components/EventLog.svelte` - Renders event stream with auto-scroll
- `components/StatsBar.svelte` - Row of stat cards
- `components/SessionList.svelte` - Active sessions panel
- `components/ToolHealthGrid.svelte` - Tool health overview cards

### Step 11: UI - Tools + Settings pages
- `tools/+page.svelte` - Lists all tools grouped by category (collapsible sections). Each tool: ToolCard with name, description, toggle switch, warning if missing API key
- `settings/+page.svelte` - Sections: API Keys (Perplexity, Firecrawl as password fields), MySQL connection fields, PostgreSQL connection fields. Auto-save on change.
- `components/ToolCard.svelte` - Card with toggle, calls POST /api/tools
- `components/SettingsField.svelte` - Input with label, password toggle, debounced save

### Step 12: Build system + testing
- Wire up scripts: `dev` (bun --watch), `dev:ui` (vite dev), `dev:all` (concurrently), `build:ui` (vite build), `build` (build:ui), `start` (bun src/index.ts)
- Test with curl against /mcp endpoint
- Test with MCP Inspector or Claude Desktop config: `{ "mcpServers": { "mcpy": { "url": "http://localhost:3001/mcp" } } }`

---

## Key Technical Decisions

- **WebStandardStreamableHTTPServerTransport** maps directly to Bun.serve's fetch(req) -> Response pattern
- **linkedom** over jsdom (lighter, Bun-compatible) for HTML parsing with @mozilla/readability
- **No Perplexity/Firecrawl SDKs** - just fetch() calls to their REST APIs
- **File-based settings/data** in src/data/ (gitignored) - simple, no database dependency for the server itself
- **Tool auto-loader** uses Bun.Glob to scan category subdirectories - adding a tool = adding a file
- **Svelte 5 runes** ($state, $derived, $effect) for reactive UI state
- **TailwindCSS v4 + DaisyUI v5** - no tailwind.config needed, just CSS imports

## Verification

1. `bun run dev` starts backend on :3001
2. `curl -X POST http://localhost:3001/mcp` with initialize request gets valid MCP response
3. `curl http://localhost:3001/api/tools` lists all tools with categories
4. `curl http://localhost:3001/api/events` opens SSE stream
5. Invoke a tool (e.g., todo_list add) via MCP and see the event appear in both SSE stream and UI dashboard
6. Toggle a tool off via UI, verify it disappears from MCP tools/list
7. Set API keys via settings page, verify web_search works
8. `bun run build` produces static UI, `bun run start` serves everything from one port
