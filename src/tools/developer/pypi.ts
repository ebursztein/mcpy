import { z } from "zod";
import type { ToolDefinition, GroupDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";
import { paginate, paginationHeader } from "../lib/paginate.ts";

export const pypiGroup: GroupDefinition = {
  id: "pypi",
  category: "developer",
  label: "PyPI",
  description: "Inspect, list versions, and read Python packages from PyPI",
  url: "https://pypi.org/",
  requiresConfig: false,
  enabledByDefault: true,
};

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface PyPIResponse {
  info: Record<string, unknown>;
  releases?: Record<string, Array<{
    packagetype: string;
    size: number;
    upload_time: string;
    upload_time_iso_8601?: string;
    filename: string;
    python_version: string;
    yanked: boolean;
    yanked_reason?: string | null;
  }>>;
  urls?: Array<{
    packagetype: string;
    size: number;
    upload_time: string;
    filename: string;
    python_version: string;
  }>;
}

// ---------------------------------------------------------------------------
// pypi_info
// ---------------------------------------------------------------------------

export const pypiInfo: ToolDefinition = {
  name: "pypi_info",
  category: "developer",
  group: "pypi",
  title: "PyPI Package Info",
  description:
    "Look up Python package information from PyPI including version, description, dependencies, license, and author.",
  inputSchema: {
    package_name: z.string().describe("Python package name"),
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

    const url = version
      ? `https://pypi.org/pypi/${encodeURIComponent(package_name)}/${version}/json`
      : `https://pypi.org/pypi/${encodeURIComponent(package_name)}/json`;

    try {
      const res = await fetch(url);

      if (!res.ok) {
        return errorResult(
          `Package "${package_name}" not found (HTTP ${res.status})`
        );
      }

      const data = (await res.json()) as PyPIResponse;
      const info = data.info;

      const requiresDist = (info.requires_dist as string[] | null) || [];

      const lines = [
        `# ${info.name}@${info.version}`,
        "",
        info.summary ? `${info.summary}` : "",
        "",
        `Author: ${info.author || info.author_email || "unknown"}`,
        `License: ${info.license || "unknown"}`,
        `Python requires: ${info.requires_python || "any"}`,
        info.home_page ? `Homepage: ${info.home_page}` : "",
      ];

      // Classifiers -- extract useful ones
      const classifiers = (info.classifiers as string[]) || [];
      const devStatus = classifiers.find((c) => c.startsWith("Development Status"));
      if (devStatus) {
        lines.push(`Status: ${devStatus.split("::").pop()?.trim()}`);
      }

      const frameworks = classifiers
        .filter((c) => c.startsWith("Framework ::"))
        .map((c) => c.split("::").pop()?.trim())
        .filter(Boolean);
      if (frameworks.length > 0) {
        lines.push(`Frameworks: ${frameworks.slice(0, 10).join(", ")}`);
      }

      lines.push("");

      if (requiresDist.length > 0) {
        const coreDeps: string[] = [];
        const extraDeps: string[] = [];

        for (const d of requiresDist) {
          const name = d.split(/[;<>=![\s]/)[0].trim();
          if (!name) continue;
          if (d.includes("extra ==")) {
            extraDeps.push(name);
          } else {
            coreDeps.push(name);
          }
        }

        const uniqueCore = [...new Set(coreDeps)];
        const uniqueExtra = [...new Set(extraDeps)];

        if (uniqueCore.length > 0) {
          lines.push(
            `Dependencies (${uniqueCore.length}): ${uniqueCore.slice(0, 20).join(", ")}${uniqueCore.length > 20 ? ` ... and ${uniqueCore.length - 20} more` : ""}`
          );
        }
        if (uniqueExtra.length > 0) {
          lines.push(
            `Optional dependencies (${uniqueExtra.length}): ${uniqueExtra.slice(0, 15).join(", ")}${uniqueExtra.length > 15 ? ` ... and ${uniqueExtra.length - 15} more` : ""}`
          );
        }
      }

      if (data.releases) {
        const releaseCount = Object.keys(data.releases).length;
        lines.push(`Total versions: ${releaseCount}`);
      }

      if (data.urls && data.urls.length > 0) {
        const wheel = data.urls.find((u) => u.packagetype === "bdist_wheel");
        const sdist = data.urls.find((u) => u.packagetype === "sdist");
        const dist = wheel || sdist;
        if (dist) {
          const sizeKb = Math.round(dist.size / 1024);
          const sizeMb = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
          lines.push(`Package size: ${sizeMb} (${dist.packagetype})`);
          if (dist.upload_time) {
            lines.push(`Published: ${dist.upload_time.split("T")[0]}`);
          }
        }
        const types = data.urls.map((u) => u.packagetype);
        const hasWheel = types.includes("bdist_wheel");
        const hasSdist = types.includes("sdist");
        lines.push(`Distributions: ${[hasWheel ? "wheel" : "", hasSdist ? "sdist" : ""].filter(Boolean).join(", ")}`);
      }

      const projectUrls = info.project_urls as Record<string, string> | null;
      if (projectUrls) {
        const urlEntries = Object.entries(projectUrls).slice(0, 5);
        if (urlEntries.length > 0) {
          lines.push("");
          lines.push("Links:");
          for (const [label, url] of urlEntries) {
            lines.push(`  ${label}: ${url}`);
          }
        }
      }

      const keywords = info.keywords as string | null;
      if (keywords && keywords.length > 0) {
        const kws = keywords.split(/[,\s]+/).filter(Boolean);
        if (kws.length > 0) {
          lines.push(`Keywords: ${kws.slice(0, 15).join(", ")}${kws.length > 15 ? " ..." : ""}`);
        }
      }

      const maintainer = info.maintainer as string | null;
      const maintainerEmail = info.maintainer_email as string | null;
      if (maintainer || maintainerEmail) {
        lines.push(`Maintainer: ${maintainer || maintainerEmail}`);
      }

      return textResult(lines.filter(Boolean).join("\n"));
    } catch (err) {
      return errorResult(
        `Failed to fetch PyPI info: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

// ---------------------------------------------------------------------------
// pypi_versions
// ---------------------------------------------------------------------------

export const pypiVersions: ToolDefinition = {
  name: "pypi_versions",
  category: "developer",
  group: "pypi",
  title: "PyPI Package Versions",
  description:
    "List all published versions of a Python package with upload dates, sorted newest first. Shows yanked versions and distribution types.",
  inputSchema: {
    package_name: z.string().describe("Python package name"),
  },
  async handler(params) {
    const { package_name } = params as { package_name: string };

    try {
      const url = `https://pypi.org/pypi/${encodeURIComponent(package_name)}/json`;
      const res = await fetch(url);

      if (!res.ok) {
        return errorResult(`Package "${package_name}" not found (HTTP ${res.status})`);
      }

      const data = (await res.json()) as PyPIResponse;

      if (!data.releases) {
        return errorResult(`No version history available for "${package_name}"`);
      }

      const info = data.info;
      const latest = info.version as string;

      // Build version list with dates from release files
      const versions: Array<{ version: string; date: string; yanked: boolean; types: string[] }> = [];

      for (const [ver, files] of Object.entries(data.releases)) {
        if (files.length === 0) continue; // skip empty releases

        // Use the earliest upload time as the release date
        const dates = files.map((f) => f.upload_time).sort();
        const date = dates[0] ? dates[0].split("T")[0] : "unknown";
        const yanked = files.some((f) => f.yanked);
        const types = [...new Set(files.map((f) => f.packagetype))];

        versions.push({ version: ver, date, yanked, types });
      }

      // Sort by date descending
      versions.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

      const lines = [
        `# ${package_name} -- ${versions.length} versions`,
        `Latest: ${latest}`,
        "",
      ];

      for (const v of versions) {
        const tag = v.version === latest ? " [latest]" : "";
        const yanked = v.yanked ? " (yanked)" : "";
        const types = v.types.join(", ");
        lines.push(`  ${v.version.padEnd(20)} ${v.date}  ${types}${tag}${yanked}`);
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
// pypi_readme
// ---------------------------------------------------------------------------

export const pypiReadme: ToolDefinition = {
  name: "pypi_readme",
  category: "developer",
  group: "pypi",
  title: "PyPI Package README",
  description:
    "Fetch the long description (README) of a Python package from PyPI. Returns the full content with pagination. The content type (markdown, rst, plain) is indicated in the header.",
  inputSchema: {
    package_name: z.string().describe("Python package name"),
    version: z.string().optional().describe("Specific version (default: latest)"),
    start_index: z.number().default(0).describe("Character offset to start from (default: 0)"),
    max_length: z.number().default(5000).describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params) {
    const { package_name, version, start_index, max_length } = params as {
      package_name: string;
      version?: string;
      start_index: number;
      max_length: number;
    };

    try {
      const url = version
        ? `https://pypi.org/pypi/${encodeURIComponent(package_name)}/${version}/json`
        : `https://pypi.org/pypi/${encodeURIComponent(package_name)}/json`;
      const res = await fetch(url);

      if (!res.ok) {
        return errorResult(`Package "${package_name}" not found (HTTP ${res.status})`);
      }

      const data = (await res.json()) as PyPIResponse;
      const description = data.info.description as string | undefined;
      const contentType = (data.info.description_content_type as string) || "text/plain";

      if (!description || description.trim().length === 0) {
        return errorResult(`No description/README found for "${package_name}"`);
      }

      const { chunk, total, hasMore } = paginate(description, start_index, max_length);

      const header = [
        `README: ${package_name}${version ? `@${version}` : `@${data.info.version}`} (${contentType})`,
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
