// Pure data -- no runtime imports (zod, handlers, etc.)
// Single source of truth for tool/group display data used by both
// the mcpy backend and the static Astro site.

export interface CatalogTool {
  name: string;
  title: string;
  description: string;
  remote?: boolean;
}

export interface CatalogGroup {
  id: string;
  category: string;
  label: string;
  description: string;
  url?: string;
  remote?: boolean;
  requiresConfig: boolean;
  tools: CatalogTool[];
}

export const TOOL_CATALOG: CatalogGroup[] = [
  {
    id: "mcpy",
    category: "agent",
    label: "mcpy",
    description: "Server management, logs, stats, and updates",
    url: "https://github.com/ebursztein/mcpy",
    requiresConfig: false,
    tools: [
      { name: "mcpy_log", title: "mcpy Server Log", description: "Read the mcpy server log file (~/.mcpy/mcpy.log)" },
      { name: "mcpy_restart", title: "Restart mcpy", description: "Restart the mcpy server process" },
      { name: "mcpy_stats", title: "mcpy Server Stats", description: "Show runtime statistics: uptime, process info, tool invocation counts" },
      { name: "mcpy_update", title: "Update mcpy", description: "Check for and install mcpy updates" },
    ],
  },
  {
    id: "notes",
    category: "agent",
    label: "Notes",
    description: "Persistent markdown notes with tags, search, and grep",
    requiresConfig: false,
    tools: [
      { name: "notes_add", title: "Add Note", description: "Create a new note with title, tags, description, and content" },
      { name: "notes_read", title: "Read Note", description: "Read a note by id with offset/max_length pagination" },
      { name: "notes_delete", title: "Delete Note", description: "Delete a note by id" },
      { name: "notes_search", title: "Search Notes", description: "Search notes by title, tags, or description" },
      { name: "notes_grep", title: "Grep Notes", description: "Search note contents by regex pattern" },
      { name: "notes_list", title: "List Notes", description: "List all notes with metadata summary" },
      { name: "notes_update_metadata", title: "Update Note Metadata", description: "Update title, tags, description, or pinned status" },
      { name: "notes_update_content", title: "Update Note Content", description: "Update content at specific offset or append/prepend" },
    ],
  },
  {
    id: "mysql",
    category: "database",
    label: "MySQL",
    description: "Query and explore MySQL databases on your network",
    url: "https://dev.mysql.com/doc/",
    requiresConfig: true,
    tools: [
      { name: "mysql_query", title: "MySQL Query", description: "Execute SQL queries with parameterized inputs and read-only mode" },
      { name: "mysql_list_tables", title: "MySQL List Tables", description: "List all tables with row counts and engine info" },
      { name: "mysql_describe_table", title: "MySQL Describe Table", description: "Show columns, indexes, and foreign keys" },
    ],
  },
  {
    id: "postgres",
    category: "database",
    label: "PostgreSQL",
    description: "Query and explore PostgreSQL databases on your network",
    url: "https://www.postgresql.org/docs/",
    requiresConfig: true,
    tools: [
      { name: "postgres_query", title: "PostgreSQL Query", description: "Execute SQL queries with parameterized inputs and read-only mode" },
      { name: "postgres_list_tables", title: "PostgreSQL List Tables", description: "List all tables with row count estimates" },
      { name: "postgres_describe_table", title: "PostgreSQL Describe Table", description: "Show columns, indexes, and foreign keys" },
    ],
  },
  {
    id: "npm",
    category: "developer",
    label: "npm",
    description: "Search, inspect, and read npm packages from the registry",
    url: "https://www.npmjs.com/",
    requiresConfig: false,
    tools: [
      { name: "npm_info", title: "npm Package Info", description: "Look up version, description, dependencies, license, downloads, and publish info" },
      { name: "npm_search", title: "npm Search", description: "Search the npm registry for packages by query with qualifiers" },
      { name: "npm_versions", title: "npm Versions", description: "List all published versions with dates and dist-tags" },
      { name: "npm_readme", title: "npm README", description: "Fetch the README of an npm package with pagination" },
    ],
  },
  {
    id: "pypi",
    category: "developer",
    label: "PyPI",
    description: "Inspect, list versions, and read Python packages from PyPI",
    url: "https://pypi.org/",
    requiresConfig: false,
    tools: [
      { name: "pypi_info", title: "PyPI Package Info", description: "Look up version, description, dependencies, license, author, and distribution info" },
      { name: "pypi_versions", title: "PyPI Versions", description: "List all published versions with dates, dist types, and yanked status" },
      { name: "pypi_readme", title: "PyPI README", description: "Fetch the long description/README with pagination" },
    ],
  },
  {
    id: "github",
    category: "developer",
    label: "GitHub",
    description: "Search code, read files, and grep patterns across GitHub repositories",
    url: "https://github.com/",
    requiresConfig: true,
    tools: [
      { name: "github_search", title: "GitHub Code Search", description: "Search GitHub code with qualifiers like language, repo, path, and extension" },
      { name: "github_file", title: "GitHub File", description: "Fetch a file from a GitHub repository with pagination and caching" },
      { name: "github_grep", title: "GitHub Grep", description: "Grep a GitHub file for a regex pattern with context lines" },
    ],
  },
  {
    id: "fetch",
    category: "web",
    label: "Fetch",
    description: "Fetch web pages, inspect headers, grep content, and download files",
    requiresConfig: false,
    tools: [
      { name: "web_fetch_text", title: "Web Fetch", description: "Fetch a webpage and extract clean readable text using Mozilla Readability" },
      { name: "web_fetch_raw", title: "Web Fetch Raw", description: "Fetch a webpage and return the raw HTML" },
      { name: "web_http_headers", title: "HTTP Headers", description: "Inspect HTTP response headers, redirects, and server info" },
      { name: "web_grep", title: "Web Grep", description: "Fetch a webpage and search for a regex pattern with context" },
      { name: "web_fetch_binary", title: "Web Fetch Binary", description: "Download a file from a URL to local storage" },
    ],
  },
  {
    id: "perplexity",
    category: "web",
    label: "Perplexity",
    description: "AI-powered web search with citations",
    url: "https://docs.perplexity.ai/",
    remote: true,
    requiresConfig: true,
    tools: [
      { name: "perplexity_search", title: "Perplexity Search", description: "Search the web using Perplexity AI with citations", remote: true },
    ],
  },
];
