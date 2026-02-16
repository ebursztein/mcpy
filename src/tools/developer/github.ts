import { z } from "zod";
import type { ToolDefinition, ToolContext, GroupDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";
import { paginate, paginationHeader } from "../lib/paginate.ts";
import { grepLines } from "../lib/grep.ts";
import { TtlCache } from "../lib/cache.ts";

export const githubGroup: GroupDefinition = {
  id: "github",
  category: "developer",
  label: "GitHub",
  description: "Search code, read files, and grep patterns across GitHub repositories. Token: github.com/settings/tokens (no scopes needed)",
  url: "https://github.com/settings/tokens",
  requiresConfig: true,
  enabledByDefault: true,
  settingsFields: [
    { key: "apiKeys.github", label: "Personal Access Token", type: "password", placeholder: "ghp_...", gridSpan: 2 },
  ],
};

const fileCache = new TtlCache(15 * 60 * 1000, 100);

function authHeaders(context: ToolContext): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "mcpy-github-tool",
  };
  const token = context.settings.apiKeys?.github;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string | undefined,
  context: ToolContext,
): Promise<string> {
  const cacheKey = `${owner}/${repo}/${path}@${ref || "HEAD"}`;
  const cached = fileCache.get(cacheKey);
  if (cached !== null) return cached;

  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref || "HEAD")}/${path}`;
  const res = await fetch(url, { headers: authHeaders(context) });

  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status}: ${res.statusText} for ${owner}/${repo}/${path}`);
  }

  const content = await res.text();
  fileCache.set(cacheKey, content);
  return content;
}

// --- Tools ---

export const githubSearch: ToolDefinition = {
  name: "github_search",
  category: "developer",
  group: "github",
  title: "GitHub Code Search",
  description:
    'Search GitHub code. Returns matching file paths and code snippets. Supports qualifiers like `language:typescript`, `repo:owner/name`, `path:src/`, `extension:ts`. Works without a token (rate-limited to 10 req/min; 30 with token).',
  requiredSettings: ["apiKeys.github"],
  inputSchema: {
    query: z.string().describe('Search query. Supports GitHub qualifiers like "language:svelte repo:chartjs/Chart.js"'),
    per_page: z.number().min(1).max(30).default(5).describe("Results per page (default: 5, max: 30)"),
    page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  },
  async handler(params, context) {
    const { query, per_page, page } = params as { query: string; per_page: number; page: number };

    try {
      const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${per_page}&page=${page}`;
      const res = await fetch(url, { headers: authHeaders(context) });

      if (!res.ok) {
        const errText = await res.text();
        return errorResult(`GitHub API ${res.status}: ${errText}`);
      }

      const data = (await res.json()) as {
        total_count: number;
        items: Array<{
          name: string;
          path: string;
          repository: { full_name: string };
          html_url: string;
          text_matches?: Array<{ fragment: string }>;
        }>;
      };

      const lines = [
        `Found ${data.total_count.toLocaleString()} results (showing page ${page}, ${per_page}/page)`,
        "",
      ];

      for (const item of data.items) {
        lines.push(`--- ${item.repository.full_name}/${item.path}`);
        lines.push(`    ${item.html_url}`);
        if (item.text_matches) {
          for (const match of item.text_matches.slice(0, 2)) {
            const fragment = match.fragment.trim().replace(/\n/g, "\n    ");
            lines.push(`    ${fragment}`);
          }
        }
        lines.push("");
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(`GitHub search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

export const githubFile: ToolDefinition = {
  name: "github_file",
  category: "developer",
  group: "github",
  title: "GitHub File",
  description:
    "Fetch a file from a GitHub repository. Returns raw content with offset/max_length pagination. Results are cached for 15 minutes.",
  requiredSettings: ["apiKeys.github"],
  inputSchema: {
    owner: z.string().describe("Repository owner (e.g. 'chartjs')"),
    repo: z.string().describe("Repository name (e.g. 'Chart.js')"),
    path: z.string().describe("File path (e.g. 'src/types/index.ts')"),
    ref: z.string().optional().describe("Branch, tag, or commit SHA (default: HEAD)"),
    start_index: z.number().default(0).describe("Character offset to start from (default: 0)"),
    max_length: z.number().default(5000).describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params, context) {
    const { owner, repo, path, ref, start_index, max_length } = params as {
      owner: string; repo: string; path: string; ref?: string; start_index: number; max_length: number;
    };

    try {
      const content = await fetchFileContent(owner, repo, path, ref, context);
      const { chunk, total, hasMore } = paginate(content, start_index, max_length);

      const meta = [
        `File: ${owner}/${repo}/${path}${ref ? `@${ref}` : ""}`,
        `Total: ${total} chars`,
        `Showing: ${start_index}-${start_index + chunk.length}`,
        hasMore ? `Has more: true (use start_index=${start_index + max_length} to continue)` : "Has more: false",
        "---",
      ].join("\n");

      return textResult(meta + "\n" + chunk);
    } catch (err) {
      return errorResult(`Failed to fetch file: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

export const githubGrep: ToolDefinition = {
  name: "github_grep",
  category: "developer",
  group: "github",
  title: "GitHub Grep",
  description:
    "Fetch a file from GitHub and grep for a pattern. Returns matching lines with surrounding context. Much more efficient than reading an entire file when you know what you are looking for. Results are cached.",
  requiredSettings: ["apiKeys.github"],
  inputSchema: {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path"),
    pattern: z.string().describe("Regex pattern to search for (case-insensitive)"),
    ref: z.string().optional().describe("Branch, tag, or commit SHA (default: HEAD)"),
    context_lines: z.number().min(0).max(20).default(3).describe("Lines of context around each match (default: 3)"),
    max_matches: z.number().min(1).max(50).default(10).describe("Maximum number of matches to return (default: 10)"),
    start_index: z.number().default(0).describe("Character offset to start from (for pagination)"),
    max_length: z.number().default(5000).describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params, context) {
    const { owner, repo, path, pattern, ref, context_lines, max_matches, start_index, max_length } = params as {
      owner: string; repo: string; path: string; pattern: string; ref?: string;
      context_lines: number; max_matches: number; start_index: number; max_length: number;
    };

    try {
      const content = await fetchFileContent(owner, repo, path, ref, context);
      const lines = content.split("\n");

      let result;
      try {
        result = grepLines(lines, pattern, context_lines, max_matches);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      if (result.matches === 0) {
        return textResult(`File: ${owner}/${repo}/${path} (${lines.length} lines)\nNo matches for pattern: ${pattern}`);
      }

      const header = [
        `File: ${owner}/${repo}/${path} (${lines.length} lines)`,
        `Pattern: ${pattern}`,
        `Matches: ${result.matches}${result.capped ? ` (capped at ${max_matches})` : ""}`,
        "---",
      ].join("\n");

      const full = header + "\n" + result.output;
      const { chunk, total, hasMore } = paginate(full, start_index, max_length);

      if (start_index > 0 || hasMore) {
        return textResult(paginationHeader(start_index, chunk, total, hasMore, max_length) + "\n" + chunk);
      }

      return textResult(chunk);
    } catch (err) {
      return errorResult(`GitHub grep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
