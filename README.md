# mcpy

A self-contained MCP tool server that compiles to a single binary. Ships with a web dashboard for managing tools, settings, and monitoring.

Built with [Bun](https://bun.sh), [MCP SDK](https://modelcontextprotocol.io), and [SvelteKit](https://svelte.dev).

## Install

### Prerequisites

- [Bun](https://bun.sh) v1.1+ (build time only -- the compiled binary has no runtime dependencies)

### Setup

```bash
git clone https://github.com/user/mcpy.git
cd mcpy
bun install
cd ui && bun install && cd ..
```

### Build

```bash
bun run build      # build the web UI
bun run compile    # compile standalone binary
```

This produces a `./mcpy` binary (~60MB) that includes everything -- server, tools, and UI assets. No Bun or Node.js needed at runtime.

### Register with Claude Desktop

Open the web UI at `http://localhost:3713/settings` and click **Install to Claude Desktop**, or manually add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "mcpy": {
      "command": "/absolute/path/to/mcpy"
    }
  }
}
```

### Register with Claude Code

```bash
claude mcp add mcpy /absolute/path/to/mcpy
```

## Development

```bash
bun run dev:all    # runs server (watch mode) + UI (vite dev) concurrently
```

- Server: `http://localhost:3713` (API + static UI)
- UI dev: `http://localhost:5173` (vite, proxies API to 3713)

## Tools

mcpy ships with built-in tools organized by category:

### Agent

| Tool | Description |
|------|-------------|
| `todo_list` | Persistent task tracking (add, update, remove, list) |
| `memory` | Key-value store for facts and preferences across sessions |
| `mcpy_log` | Read the server log for debugging |
| `mcpy_restart` | Restart the server process (auto-reconnects) |
| `mcpy_stats` | Runtime statistics: uptime, memory, invocation counts |

### Database

| Tool | Description |
|------|-------------|
| `mysql_query` | Execute SQL queries (parameterized, read-only mode) |
| `mysql_list_tables` | List tables with row counts and engine info |
| `mysql_describe_table` | Show columns, indexes, and foreign keys |
| `postgres_query` | Execute SQL queries (parameterized, read-only mode) |
| `postgres_list_tables` | List tables with row count estimates |
| `postgres_describe_table` | Show columns, indexes, and foreign keys |

### Developer

| Tool | Description |
|------|-------------|
| `npm_info` | Look up npm package details (version, deps, downloads) |
| `pypi_info` | Look up PyPI package details (version, deps, license) |

### Web

| Tool | Description |
|------|-------------|
| `web_fetch` | Fetch and extract clean text from web pages |
| `http_headers` | Inspect HTTP response headers from any URL |
| `web_search` | Search the web via Perplexity AI (requires API key) |

## Configuration

All configuration is managed through the web UI at `/settings` or stored in `~/.mcpy/settings.json`.

### API Keys

| Key | Used by |
|-----|---------|
| Perplexity | `web_search` tool |

Set via the UI or environment variable `PERPLEXITY_API_KEY`.

### Database Connections

Configure MySQL and PostgreSQL connections (host, port, user, password, database) through the settings UI. Database tools auto-disable when no connection is configured.

### Tool Toggles

Each tool can be individually enabled or disabled from the tools page. Disabled tools are not registered with the MCP server.

## Web Dashboard

The built-in dashboard at `http://localhost:3713` provides:

- **Dashboard** -- live event stream, tool health indicators, active sessions, aggregate stats
- **Tools** -- enable/disable individual tools, see status and missing config
- **Settings** -- API keys, database connections, Claude Desktop install management

## Project Structure

```
src/
  index.ts              Entry point (MCP stdio + HTTP server)
  api.ts                REST API endpoints
  settings.ts           Settings persistence
  events.ts             Event bus and stats
  types.ts              Shared types
  tools/
    base.ts             Tool interface and helpers
    index.ts            Tool registry
    agent/              todo_list, memory
    database/           mysql, postgres (3 tools each)
    debug/              mcpy log, restart, stats
    developer/          npm_info, pypi_info
    web/                web_fetch, http_headers, web_search
ui/
  src/
    routes/             SvelteKit pages (dashboard, tools, settings)
    lib/
      api.ts            Frontend API client
      components/       Svelte 5 components
```

## License

MIT
