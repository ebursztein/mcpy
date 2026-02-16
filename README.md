# mcpy

A fully compiled MCP server distributed as a single binary. Ships with a web dashboard for managing tools, settings, and monitoring. Zero runtime dependencies.

**Website:** [mcpy.app](https://mcpy.app) | **Source:** [GitHub](https://github.com/ebursztein/mcpy)

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

mcpy runs as an MCP server that Claude Desktop, Claude Code, and Cursor connect to via stdio. It exposes 34 tools across 4 categories, and serves a web dashboard at `http://localhost:3713` for managing everything.

## Tools

### Agent

| Group | Tools | Description |
|-------|-------|-------------|
| mcpy | `mcpy_log`, `mcpy_restart`, `mcpy_stats`, `mcpy_update` | Server management, logs, stats, and updates |
| notes | `notes_add`, `notes_read`, `notes_delete`, `notes_search`, `notes_grep`, `notes_list`, `notes_update_metadata`, `notes_update_content` | Persistent markdown notes with tags, search, and grep |

### Database

| Group | Tools | Description |
|-------|-------|-------------|
| mysql | `mysql_query`, `mysql_list_tables`, `mysql_describe_table` | Query and explore MySQL databases |
| postgres | `postgres_query`, `postgres_list_tables`, `postgres_describe_table` | Query and explore PostgreSQL databases |

### Developer

| Group | Tools | Description |
|-------|-------|-------------|
| npm | `npm_info`, `npm_search`, `npm_versions`, `npm_readme` | Search, inspect, and read npm packages |
| pypi | `pypi_info`, `pypi_versions`, `pypi_readme` | Inspect and read Python packages from PyPI |
| github | `github_search`, `github_file`, `github_grep` | Search code, read files, and grep across GitHub repos |

### Web

| Group | Tools | Description |
|-------|-------|-------------|
| fetch | `web_fetch_text`, `web_fetch_raw`, `web_http_headers`, `web_grep`, `web_fetch_binary` | Fetch pages, inspect headers, grep content, download files |
| perplexity | `perplexity_search` | AI-powered web search with citations (requires API key) |

## Configuration

All configuration is managed through the web dashboard at `http://localhost:3713` or stored in `~/.mcpy/settings.json`.

- **API keys** -- Perplexity (for `perplexity_search`), GitHub (for `github_*`). Set via UI or env vars.
- **Database connections** -- MySQL and PostgreSQL (host, port, user, password, database). Tools auto-disable when not configured.
- **Tool toggles** -- Enable/disable individual tools or entire groups from the Tool Config page.

## Web Dashboard

The built-in dashboard at `http://localhost:3713`:

- **Dashboard** -- live event stream, tool health, active sessions, stats
- **Tool Config** -- enable/disable tools and groups, configure API keys and database connections
- **AI Clients** -- version/update status, install/uninstall to Claude Desktop, Claude Code, Cursor, VS Code, Codex

## CLI Commands

```
mcpy              Start MCP server (stdio + HTTP)
mcpy install      Register with AI clients (Claude Desktop, Claude Code, Cursor, etc.)
mcpy uninstall    Remove from all AI client configs
mcpy tray         Start system tray icon
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
    agent/              notes (8 tools), mcpy (4 tools)
    database/           mysql (3 tools), postgres (3 tools)
    developer/          npm (4 tools), pypi (3 tools), github (3 tools)
    web/                fetch (5 tools), perplexity (1 tool)
    debug/              mcpy log, restart, stats, update
test/
  lib/                  Shared test harness + MCP client helpers
  tools/                Per-tool-group tests (notes, mcpy, npm, pypi, github, fetch)
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
