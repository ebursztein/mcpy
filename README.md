# mcpy

A fully compiled MCP server distributed as a single binary. Ships with a web dashboard for managing tools, settings, and monitoring. Zero runtime dependencies.

## Install

```bash
curl -fsSL https://mcpy.app/install.sh | bash
```

This downloads the binary, verifies its SHA256 checksum, installs to `~/.mcpy/bin/mcpy`, and registers with Claude Desktop and Claude Code automatically. No runtime dependencies needed.

### Manual install

Download the binary for your platform from [releases](https://github.com/ebursztein/mcpy/releases), then:

```bash
chmod +x mcpy && ./mcpy install
```

### Update

```bash
~/.mcpy/bin/mcpy update
```

Or use the `mcpy_update` tool from within Claude.

### Uninstall

```bash
~/.mcpy/bin/mcpy uninstall
rm -rf ~/.mcpy
```

## What it does

mcpy runs as an MCP server that Claude Desktop and Claude Code connect to via stdio. It exposes 17 tools across 4 categories, and serves a web dashboard at `http://localhost:3713` for managing everything.

## Tools

### Agent

| Tool | Description |
|------|-------------|
| `todo_list` | Persistent task tracking (add, update, remove, list) |
| `memory` | Key-value store for facts and preferences across sessions |
| `mcpy_log` | Read the server log for debugging |
| `mcpy_restart` | Restart the server process (auto-reconnects) |
| `mcpy_stats` | Runtime statistics: uptime, memory, invocation counts |
| `mcpy_update` | Check for updates and install them |

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

All configuration is managed through the web UI at `http://localhost:3713/settings` or stored in `~/.mcpy/settings.json`.

- **API keys** -- Perplexity (for web_search). Set via UI or `PERPLEXITY_API_KEY` env var.
- **Database connections** -- MySQL and PostgreSQL (host, port, user, password, database). Tools auto-disable when not configured.
- **Tool toggles** -- Enable/disable individual tools from the tools page.

## Web Dashboard

The built-in dashboard at `http://localhost:3713`:

- **Dashboard** -- live event stream, tool health, active sessions, stats
- **Tools** -- enable/disable individual tools, see missing config
- **Settings** -- version/update status, API keys, database connections, Claude Desktop install

## CLI Commands

```
mcpy              Start MCP server (stdio + HTTP)
mcpy install      Register with Claude Desktop and Claude Code
mcpy uninstall    Remove from Claude Desktop and Claude Code
mcpy update       Check for and install updates
mcpy version      Print version
```

## Development

Requires [Bun](https://bun.sh) v1.1+.

```bash
git clone https://github.com/ebursztein/mcpy.git
cd mcpy
bun install && cd ui && bun install && cd ..
bun run dev:all    # server (watch) + UI (vite) concurrently
```

Build and compile:

```bash
bun run build      # build web UI
bun run compile    # compile standalone binary
```

## Testing

Tests live in `test/` with a modular structure: shared harness, per-tool-group test files, and integration suites.

### Local (development)

Run all tests against the compiled binary in the repo root:

```bash
bun run build && bun run compile   # build UI + compile binary
bun run test                       # run all tests against ./mcpy
```

This connects to the binary via MCP stdio, exercises every tool group, then validates the HTTP API and web UI. Results are printed with pass/fail counts and the process exits non-zero on any failure.

### Integration (Podman container)

Full end-to-end validation in an isolated container -- builds from source, compiles, installs, and tests:

```bash
bun run test:integration
```

Requires [Podman](https://podman.io). The container uses `oven/bun:latest`, builds the UI, compiles the binary, then runs the same test suite.

### Releasing

Trigger the **Release** workflow from GitHub Actions (workflow_dispatch). It runs integration tests first, then builds binaries for macOS (x64, arm64) and Linux (x64, arm64), generates SHA256SUMS, creates a git tag, and publishes a GitHub release. The release is blocked if any test fails. No manual version bumping needed.

## Project Structure

```
src/
  index.ts              Entry point (MCP stdio + HTTP server + CLI)
  version.ts            Version from package.json
  update.ts             Auto-update logic (GitHub releases + SHA256)
  api.ts                REST API endpoints
  settings.ts           Settings persistence (~/.mcpy/settings.json)
  events.ts             Event bus, stats, SSE streaming
  types.ts              Shared TypeScript types
  tools/
    base.ts             ToolDefinition interface, helpers
    index.ts            Tool registry and MCP registration
    agent/              todo_list, memory
    debug/              mcpy log, restart, stats, update
    database/           mysql (3 tools), postgres (3 tools)
    developer/          npm_info, pypi_info
    web/                web_fetch, http_headers, web_search
test/
  lib/                  Shared test harness + MCP client helpers
  tools/                Per-tool-group tests (todo, memory, mcpy, packages, fetch)
  suites/               Integration suites (install, http, ui)
  integration.ts        Test orchestrator
  Containerfile         Podman build-from-source container
  run.sh                Podman wrapper script
site/                   Landing page (mcpy.app) + install script
ui/                     SvelteKit 5 + TailwindCSS v4 + DaisyUI v5
.github/workflows/      Release CI (test gate + 4-platform cross-compile)
```

## License

MIT
