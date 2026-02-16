import { z } from "zod";
import type { ToolDefinition, GroupDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";
import { paginate, paginationHeader } from "../lib/paginate.ts";

export const npmGroup: GroupDefinition = {
  id: "npm",
  category: "developer",
  label: "npm",
  description: "Search, inspect, and read npm packages from the registry",
  url: "https://www.npmjs.com/",
  requiresConfig: false,
  enabledByDefault: true,
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Fetch the full packument (all versions, readme, time) for a package. */
async function fetchPackument(packageName: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
  if (!res.ok) throw new Error(`Package "${packageName}" not found (HTTP ${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// npm_info
// ---------------------------------------------------------------------------

export const npmInfo: ToolDefinition = {
  name: "npm_info",
  category: "developer",
  group: "npm",
  title: "npm Package Info",
  description:
    "Look up npm package information including version, description, dependencies, license, and weekly downloads.",
  inputSchema: {
    package_name: z.string().describe("npm package name"),
    version: z
      .string()
      .optional()
      .describe("Specific version to look up (default: latest)"),
  },
  async handler(params) {
    const { package_name, version } = params as {
      package_name: string;
      version?: string;
    };

    const versionUrl = version
      ? `https://registry.npmjs.org/${encodeURIComponent(package_name)}/${version}`
      : `https://registry.npmjs.org/${encodeURIComponent(package_name)}/latest`;

    try {
      const [pkgRes, downloadsRes, fullRes] = await Promise.all([
        fetch(versionUrl),
        fetch(
          `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(package_name)}`
        ),
        fetch(`https://registry.npmjs.org/${encodeURIComponent(package_name)}`),
      ]);

      if (!pkgRes.ok) {
        return errorResult(
          `Package "${package_name}" not found (HTTP ${pkgRes.status})`
        );
      }

      const pkg = (await pkgRes.json()) as Record<string, unknown>;
      const downloads = downloadsRes.ok
        ? ((await downloadsRes.json()) as { downloads?: number })
        : null;

      const full = fullRes.ok
        ? ((await fullRes.json()) as Record<string, unknown>)
        : null;

      const deps = pkg.dependencies
        ? Object.keys(pkg.dependencies as Record<string, string>)
        : [];
      const devDeps = pkg.devDependencies
        ? Object.keys(pkg.devDependencies as Record<string, string>)
        : [];
      const peerDeps = pkg.peerDependencies
        ? Object.keys(pkg.peerDependencies as Record<string, string>)
        : [];

      const lines = [
        `# ${package_name}@${pkg.version}`,
        "",
        pkg.description ? `${pkg.description}` : "",
        "",
        `License: ${pkg.license || "unknown"}`,
        `Homepage: ${(pkg.homepage as string) || "n/a"}`,
        downloads?.downloads != null
          ? `Weekly downloads: ${downloads.downloads.toLocaleString()}`
          : "",
      ];

      const engines = pkg.engines as Record<string, string> | undefined;
      if (engines) {
        const parts = Object.entries(engines).map(([k, v]) => `${k} ${v}`);
        lines.push(`Engines: ${parts.join(", ")}`);
      }

      const types = pkg.types || pkg.typings;
      if (types) {
        lines.push(`Types: ${types}`);
      } else if (pkg.name && typeof pkg.name === "string") {
        const exports = pkg.exports as Record<string, unknown> | undefined;
        if (exports) {
          const hasTypes = JSON.stringify(exports).includes(".d.ts");
          if (hasTypes) lines.push("Types: bundled");
        }
      }

      lines.push("");

      if (deps.length > 0) {
        lines.push(
          `Dependencies (${deps.length}): ${deps.slice(0, 20).join(", ")}${deps.length > 20 ? ` ... and ${deps.length - 20} more` : ""}`
        );
      }
      if (peerDeps.length > 0) {
        lines.push(
          `Peer dependencies (${peerDeps.length}): ${peerDeps.join(", ")}`
        );
      }
      if (devDeps.length > 0) {
        lines.push(
          `Dev dependencies (${devDeps.length}): ${devDeps.slice(0, 10).join(", ")}${devDeps.length > 10 ? ` ... and ${devDeps.length - 10} more` : ""}`
        );
      }

      const repo = pkg.repository as
        | { url?: string; type?: string }
        | string
        | undefined;
      if (repo) {
        const repoUrl = typeof repo === "string" ? repo : repo.url;
        if (repoUrl) lines.push(`Repository: ${repoUrl}`);
      }

      if (full) {
        const distTags = full["dist-tags"] as Record<string, string> | undefined;
        if (distTags) {
          const tags = Object.entries(distTags)
            .map(([tag, ver]) => `${tag}: ${ver}`)
            .join(", ");
          lines.push(`Dist-tags: ${tags}`);
        }

        const time = full.time as Record<string, string> | undefined;
        const ver = pkg.version as string;
        if (time && ver && time[ver]) {
          const d = new Date(time[ver]);
          lines.push(`Published: ${d.toISOString().split("T")[0]}`);
        }

        const versions = full.versions as Record<string, unknown> | undefined;
        if (versions) {
          lines.push(`Total versions: ${Object.keys(versions).length}`);
        }

        const maintainers = full.maintainers as Array<{ name: string; email?: string }> | undefined;
        if (maintainers && maintainers.length > 0) {
          const names = maintainers.slice(0, 5).map((m) => m.name);
          lines.push(
            `Maintainers: ${names.join(", ")}${maintainers.length > 5 ? ` ... and ${maintainers.length - 5} more` : ""}`
          );
        }
      }

      const keywords = pkg.keywords as string[] | undefined;
      if (keywords && keywords.length > 0) {
        lines.push(`Keywords: ${keywords.slice(0, 15).join(", ")}${keywords.length > 15 ? " ..." : ""}`);
      }

      return textResult(lines.filter(Boolean).join("\n"));
    } catch (err) {
      return errorResult(
        `Failed to fetch npm info: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

// ---------------------------------------------------------------------------
// npm_search
// ---------------------------------------------------------------------------

export const npmSearch: ToolDefinition = {
  name: "npm_search",
  category: "developer",
  group: "npm",
  title: "npm Search",
  description:
    'Search the npm registry for packages. Supports qualifiers: author:name, keywords:term, scope:foo, not:unstable, is:insecure. Returns name, version, description, and score.',
  inputSchema: {
    query: z.string().describe('Search query. Supports qualifiers like "author:sindresorhus", "keywords:cli"'),
    size: z.number().min(1).max(50).default(10).describe("Number of results (default: 10, max: 50)"),
    from: z.number().min(0).default(0).describe("Offset for pagination (default: 0)"),
  },
  async handler(params) {
    const { query, size, from } = params as { query: string; size: number; from: number };

    try {
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${size}&from=${from}`;
      const res = await fetch(url);

      if (!res.ok) {
        return errorResult(`npm search failed (HTTP ${res.status})`);
      }

      const data = (await res.json()) as {
        total: number;
        objects: Array<{
          package: {
            name: string;
            version: string;
            description?: string;
            date: string;
            links?: { npm?: string; homepage?: string; repository?: string };
            publisher?: { username: string };
            keywords?: string[];
          };
          score: { final: number };
        }>;
      };

      const lines = [
        `Found ${data.total.toLocaleString()} packages (showing ${from + 1}-${from + data.objects.length})`,
        "",
      ];

      for (const obj of data.objects) {
        const p = obj.package;
        const date = new Date(p.date).toISOString().split("T")[0];
        const score = Math.round(obj.score.final * 100);
        lines.push(`--- ${p.name}@${p.version} (score: ${score}%, ${date})`);
        if (p.description) {
          lines.push(`    ${p.description.slice(0, 120)}`);
        }
        if (p.links?.npm) {
          lines.push(`    ${p.links.npm}`);
        }
        if (p.keywords && p.keywords.length > 0) {
          lines.push(`    tags: ${p.keywords.slice(0, 8).join(", ")}`);
        }
        lines.push("");
      }

      if (data.total > from + size) {
        lines.push(`More results available (use from=${from + size} to continue)`);
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `npm search failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

// ---------------------------------------------------------------------------
// npm_versions
// ---------------------------------------------------------------------------

export const npmVersions: ToolDefinition = {
  name: "npm_versions",
  category: "developer",
  group: "npm",
  title: "npm Package Versions",
  description:
    "List all published versions of an npm package with publish dates, sorted newest first. Shows dist-tags (latest, next, beta, etc.).",
  inputSchema: {
    package_name: z.string().describe("npm package name"),
  },
  async handler(params) {
    const { package_name } = params as { package_name: string };

    try {
      const full = await fetchPackument(package_name);

      const time = full.time as Record<string, string> | undefined;
      const distTags = full["dist-tags"] as Record<string, string> | undefined;

      if (!time) {
        return errorResult(`No version history available for "${package_name}"`);
      }

      // Build tag lookup: version -> tag names
      const tagLookup = new Map<string, string[]>();
      if (distTags) {
        for (const [tag, ver] of Object.entries(distTags)) {
          const existing = tagLookup.get(ver) || [];
          existing.push(tag);
          tagLookup.set(ver, existing);
        }
      }

      // Exclude 'created' and 'modified' meta keys
      const versions = Object.entries(time)
        .filter(([k]) => k !== "created" && k !== "modified")
        .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime());

      const lines = [
        `# ${package_name} -- ${versions.length} versions`,
        "",
      ];

      if (distTags) {
        const tags = Object.entries(distTags).map(([t, v]) => `${t}: ${v}`).join(", ");
        lines.push(`Dist-tags: ${tags}`);
        lines.push("");
      }

      for (const [ver, dateStr] of versions) {
        const date = new Date(dateStr).toISOString().split("T")[0];
        const tags = tagLookup.get(ver);
        const tagStr = tags ? ` [${tags.join(", ")}]` : "";
        lines.push(`  ${ver.padEnd(20)} ${date}${tagStr}`);
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `Failed to fetch versions: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

// ---------------------------------------------------------------------------
// npm_readme
// ---------------------------------------------------------------------------

export const npmReadme: ToolDefinition = {
  name: "npm_readme",
  category: "developer",
  group: "npm",
  title: "npm Package README",
  description:
    "Fetch the README of an npm package. Returns the full markdown/text content with pagination. Useful for understanding how to use a package.",
  inputSchema: {
    package_name: z.string().describe("npm package name"),
    start_index: z.number().default(0).describe("Character offset to start from (default: 0)"),
    max_length: z.number().default(5000).describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params) {
    const { package_name, start_index, max_length } = params as {
      package_name: string;
      start_index: number;
      max_length: number;
    };

    try {
      // Try packument first (fast, works for many packages)
      let readme: string | undefined;
      let packageExists = true;
      try {
        const full = await fetchPackument(package_name);
        readme = full.readme as string | undefined;
      } catch (e) {
        // If package itself doesn't exist, propagate the error
        if (e instanceof Error && e.message.includes("not found")) {
          return errorResult(e.message);
        }
        packageExists = false;
      }

      // Fallback: fetch README.md from jsdelivr CDN
      if (!readme || readme.trim().length === 0) {
        const cdnUrl = `https://cdn.jsdelivr.net/npm/${encodeURIComponent(package_name)}/README.md`;
        const cdnRes = await fetch(cdnUrl);
        if (cdnRes.ok) {
          readme = await cdnRes.text();
        }
      }

      if (!readme || readme.trim().length === 0) {
        return errorResult(`No README found for "${package_name}"`);
      }

      const { chunk, total, hasMore } = paginate(readme, start_index, max_length);

      const header = [
        `README: ${package_name}`,
        paginationHeader(start_index, chunk, total, hasMore, max_length),
      ].join("\n");

      return textResult(header + "\n" + chunk);
    } catch (err) {
      return errorResult(
        `Failed to fetch README: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};
