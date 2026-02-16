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
- **Binary**: `bun build --compile` produces a standalone ~60MB binary. No runtime dependencies needed. The install feature registers this binary path in Claude Desktop config.

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
| web | fetch | web_fetch, http_headers |
| web | perplexity | web_search (remote) |

### Adding a new tool

1. Create a file in `src/tools/<category>/` (one file per group, exporting all tools in that group)
2. Each tool is a `ToolDefinition` with `name`, `category`, `group`, `title`, `description`, `inputSchema` (zod), `handler`
3. Import and add to `ALL_TOOLS` array in `src/tools/index.ts`
4. If it needs API keys or DB configs, add `requiredSettings: ["apiKeys.xxx"]` or `"database.xxx"`
5. If it calls a paid external API, set `remote: true`

### File conventions

- Multiple tools in the same group live in one file (e.g. `database/mysql.ts` exports mysqlQuery, mysqlListTables, mysqlDescribeTable)
- Single-tool groups use default export (e.g. `web/web_fetch.ts`)
- Shared connection helpers go at the top of the group file (e.g. `getConnection()` in mysql.ts)

## Key files

```
src/index.ts          Main entry -- MCP server + HTTP server boot + CLI (install/uninstall/update/version)
src/version.ts        VERSION constant from package.json (single source of truth)
src/update.ts         Auto-update logic (check GitHub releases, download, verify SHA256, replace)
src/api.ts            REST API handler (/api/tools, /api/settings, /api/install, /api/version, /api/update, /api/events SSE)
src/settings.ts       Settings persistence (~/.mcpy/settings.json), secret redaction
src/events.ts         Event bus, stats aggregation, SSE streaming
src/types.ts          Shared TypeScript types
src/tools/base.ts     ToolDefinition interface, ToolCategory type, result helpers
src/tools/index.ts    Tool registry, discovery, MCP registration
ui/                   SvelteKit 5 + TailwindCSS v4 + DaisyUI v5
site/                 Landing page (mcpy.app) + install.sh
.github/workflows/    Release CI (builds 4 platform binaries + SHA256SUMS)
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
- Settings (`/settings`) -- Claude Desktop install, API keys, database connections

Group labels are defined in both `ui/src/routes/tools/+page.svelte` and `ui/src/lib/components/ToolHealthGrid.svelte`. Update both when adding new groups.

## Version and release

- Version is defined in `package.json` and imported via `src/version.ts`
- `src/update.ts` handles checking GitHub releases and performing binary updates with SHA256 verification
- CLI commands: `mcpy version`, `mcpy update`, `mcpy install`, `mcpy uninstall`
- Release workflow: `npm version patch && git push --tags` triggers GitHub Actions to build 4 platform binaries + SHA256SUMS
- Website is mcpy.app, deployed from `site/` to Cloudflare Pages

## Port

Default: 3713. Override with PORT env var. Multiple instances skip HTTP if port is taken (stdio still works).
