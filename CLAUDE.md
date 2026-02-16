# mcpy

Bun-powered MCP tool server with Svelte 5 web UI. Exposes tools to AI clients (Claude Desktop, Claude Code, Cursor) via MCP stdio transport, with an HTTP dashboard for management.

## Quick commands

```bash
bun install                    # install deps (root + ui)
cd ui && bun install && cd ..  # ui deps separately if needed
bun run dev:all                # dev mode: server (watch) + UI (vite)
bun run build                  # build UI to ui/build/
bun run compile                # compile standalone binary ./mcpy
```

## Architecture

- **Transport**: MCP stdio (stdin/stdout) for AI client communication. stdout is reserved for MCP -- all logging goes to stderr + `~/.mcpy/mcpy.log`.
- **HTTP**: Bun.serve on port 3713. Serves the static UI from `ui/build/` and REST API at `/api/*`. Wrapped in try/catch so port conflicts don't kill the stdio transport.
- **Binary**: `bun build --compile` produces a standalone ~60MB binary. No runtime dependencies needed. The install feature registers this binary path in MCP client configs.
- **Graceful shutdown**: The HTTP server reference is stored in `src/server.ts`. On restart/update, `shutdownHttpServer()` calls `server.stop(true)` to release the port before `process.exit()`, so the new process can bind cleanly.

## Tool organization

Tools follow a 3-level hierarchy: **category** > **group** > **tool**.

- Category = section heading in the UI (agent, database, developer, web)
- Group = card in the UI (mcpy, todo, memory, mysql, postgres, packages, fetch, perplexity)
- Tool = individual toggle inside a card

Every tool MUST have both `category` and `group` set.

### Current tools

| Category | Group | Tools |
|----------|-------|-------|
| agent | mcpy | mcpy_log, mcpy_restart, mcpy_stats, mcpy_update |
| agent | todo | todo_list |
| agent | memory | memory |
| database | mysql | mysql_query, mysql_list_tables, mysql_describe_table |
| database | postgres | postgres_query, postgres_list_tables, postgres_describe_table |
| developer | packages | npm_info, pypi_info |
| developer | github | github_search, github_file, github_grep |
| web | fetch | web_fetch_text, web_fetch_raw, web_http_headers, web_grep, web_fetch_binary |
| web | perplexity | perplexity_search (remote) |

### Adding a new tool

1. Create a file in `src/tools/<category>/` (one file per group, exporting all tools in that group)
2. Each tool is a `ToolDefinition` with `name`, `category`, `group`, `title`, `description`, `inputSchema` (zod), `handler`
3. Import and add to `ALL_TOOLS` array in `src/tools/index.ts`
4. If it needs API keys or DB configs, add `requiredSettings: ["apiKeys.xxx"]` or `"database.xxx"`
5. If it calls a paid external API, set `remote: true`

### Naming conventions

- **File name = group name**: `src/tools/<category>/<group>.ts` (e.g. `web/perplexity.ts`, `database/mysql.ts`, `developer/github.ts`)
- **Tool name = `<group>_<action>`**: prefix with the group name to avoid clashes with built-in tools (e.g. `perplexity_search` not `web_search`, `github_file` not `file`)
- Multiple tools in the same group live in one file (e.g. `database/mysql.ts` exports mysqlQuery, mysqlListTables, mysqlDescribeTable)
- Single-tool groups use default export (e.g. `web/perplexity.ts`)
- Shared connection helpers go at the top of the group file (e.g. `getConnection()` in mysql.ts)

## Key files

```
src/index.ts          Main entry -- MCP server + HTTP server boot + CLI (install/uninstall/update/version)
src/version.ts        VERSION constant from package.json (single source of truth)
src/update.ts         Auto-update logic (check GitHub releases, download, verify SHA256, replace)
src/api.ts            REST API handler (/api/tools, /api/settings, /api/clients, /api/install, /api/version, /api/update, /api/events SSE)
src/server.ts         HTTP server ref + shutdownHttpServer() for graceful restart
src/settings.ts       Settings persistence (~/.mcpy/settings.json), secret redaction
src/events.ts         Event bus, stats aggregation, SSE streaming
src/types.ts          Shared TypeScript types
src/tools/base.ts     ToolDefinition interface, ToolCategory type, result helpers
src/tools/index.ts    Tool registry, discovery, MCP registration
test/                 Integration tests (see Testing section below)
ui/                   SvelteKit 5 + TailwindCSS v4 + DaisyUI v5
site/                 Landing page (mcpy.app) + install.sh
.github/workflows/    Release CI (test gate + 4-platform cross-compile)
```

## Data directory

All runtime data lives in `~/.mcpy/`:
- `settings.json` -- API keys, DB configs, tool toggles
- `mcpy.log` -- server log (readable via mcpy_log tool)
- `todos.json` -- todo list data
- `memory.json` -- memory store data

## Build & deploy cycle

After code changes:
```bash
bun run build         # rebuild UI
bun run compile       # recompile binary
```
Then call `mcpy_restart` tool to reload -- do NOT ask the user to restart Claude.

## UI

SvelteKit 5 with Svelte 5 runes, static adapter. Built output goes to `ui/build/` which the server embeds.

- Dashboard (`/`) -- live event log, tool health grid, session list, stats
- Tools (`/tools`) -- category sections with group cards, per-tool toggles
- Settings (`/settings`) -- MCP client management (install/uninstall toggles + JSON config snippet), API keys, database connections

Group labels are defined in both `ui/src/routes/tools/+page.svelte` and `ui/src/lib/components/ToolHealthGrid.svelte`. Update both when adding new groups.

## MCP client management

mcpy can install/uninstall itself to multiple MCP clients. The `MCP_CLIENTS` array in `src/api.ts` defines supported clients with their config file paths:

| Client | Config path (macOS) |
|--------|-------------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | `~/.claude.json` |
| Cursor | `~/.cursor/mcp.json` |

All clients use the same JSON format: `{ "mcpServers": { "mcpy": { "command": "/path/to/mcpy" } } }`

### API endpoints

- `GET /api/clients` -- returns status of all clients (id, name, configPath, configExists, installed) + binaryPath
- `POST /api/clients/:id/install` -- adds mcpy entry to client's config file (creates file/dirs if needed)
- `DELETE /api/clients/:id/install` -- removes mcpy entry from client's config file
- `GET/POST/DELETE /api/install` -- legacy Claude Desktop-only endpoints (kept for backwards compat)

### Adding a new client

1. Add entry to `MCP_CLIENTS` array in `src/api.ts` with `id`, `name`, and `getConfigPath()` function
2. The UI, install/uninstall, and detection all work automatically from the array

## Version and release

- Version is auto-incremented at release time: the CI reads the latest release tag and bumps the patch number (e.g. `0.2.0` -> `0.2.1` -> `0.2.2`)
- `package.json` has `0.2.0-dev` in the repo -- never bump it manually
- `src/version.ts` imports version from `package.json` at compile time
- `src/update.ts` handles checking GitHub releases and performing binary updates with SHA256 verification
- CLI commands: `mcpy version`, `mcpy update`, `mcpy install`, `mcpy uninstall`
- Release: trigger the "Release" workflow manually from GitHub Actions (workflow_dispatch). It computes the version, builds 4 platform binaries, generates SHA256SUMS, creates a git tag, and publishes a GitHub release.
- Website is mcpy.app, deployed from `site/` to Cloudflare Pages

## Testing

Tests are mandatory. Every PR must pass all tests before merge, and releases are blocked if tests fail.

### Running tests

```bash
bun run test                # local -- runs against ./mcpy compiled binary
bun run test:integration    # podman container -- builds from source end-to-end
```

`bun run test` requires a compiled binary at `./mcpy`. Build with `bun run build && bun run compile` first. Tests connect via MCP stdio, exercise all tool groups, then validate HTTP API and web UI.

### Test structure

```
test/
  lib/harness.ts      Shared assert/suite/summary + HTTP_BASE (reads PORT env var)
  lib/mcp.ts          Shared MCP client: connect, disconnect, call, text helpers
  tools/todo.ts       todo_list tool tests
  tools/memory.ts     memory tool tests
  tools/mcpy.ts       mcpy_stats, mcpy_log, mcpy_update, mcpy_restart tests
  tools/packages.ts   npm_info, pypi_info tests
  tools/fetch.ts      web_fetch, http_headers tests
  suites/install.ts   mcpy install command tests (binary copy + config registration)
  suites/http.ts      HTTP REST API tests (/api/tools, /api/version, /api/stats, /api/settings, /api/sessions)
  suites/ui.ts        Web UI serving tests (/, /tools, /settings)
  integration.ts      Orchestrator -- imports and runs all test suites
  Containerfile       Podman build-from-source container
  run.sh              Podman wrapper script
```

### Rules for tests

1. **Every new tool MUST have tests.** Add a test function in the corresponding `test/tools/<group>.ts` file. If adding a new tool group, create a new file and import it from `test/integration.ts`.
2. **Every new API endpoint MUST have tests.** Add assertions to `test/suites/http.ts`.
3. **Every new UI page MUST have tests.** Add route assertions to `test/suites/ui.ts`.
4. **Tests must be modular.** Each tool group has its own file. Each file exports a single async function. Shared logic lives in `test/lib/`.
5. **No hardcoding.** Use `HTTP_BASE` from `test/lib/harness.ts` for URLs. Use `process.env.PORT` for port config. Use platform-aware paths (see `getClaudeConfigPath()` in install.ts).
6. **Tests must be deterministic.** Clean up state before testing (e.g. `todo_list clear`). Do not depend on external services being in a specific state.
7. **Run tests before compiling a release binary.** The CI workflow enforces this -- tests run before the release job proceeds.

### Adding tests for a new tool group

1. Create `test/tools/<group>.ts` exporting `async function test<Group>()`
2. Use `suite("<group>")` from `test/lib/harness.ts` for the test section
3. Use `call("<tool_name>", { ... })` from `test/lib/mcp.ts` for MCP calls
4. Use `assert("<description>", condition, optionalDetail)` for assertions
5. Import and call the new function from `test/integration.ts` in the tool tests section

## Port

Default: 3713. Override with PORT env var. On restart, the HTTP server is stopped gracefully before exit so the port is released. If the port is held by another process on fresh start, HTTP is skipped (stdio still works).
