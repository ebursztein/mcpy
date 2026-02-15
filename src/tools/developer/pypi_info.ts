import { z } from "zod";
import type { ToolDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

const tool: ToolDefinition = {
  name: "pypi_info",
  category: "developer",
  group: "packages",
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

      const data = (await res.json()) as {
        info: Record<string, unknown>;
      };
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
        info.project_url ? `Project URL: ${info.project_url}` : "",
        "",
      ];

      if (requiresDist.length > 0) {
        // Show just package names without version specs
        const depNames = requiresDist
          .map((d) => d.split(/[;<>=![\s]/)[0].trim())
          .filter(Boolean);
        const unique = [...new Set(depNames)];
        lines.push(
          `Dependencies (${unique.length}): ${unique.slice(0, 20).join(", ")}${unique.length > 20 ? ` ... and ${unique.length - 20} more` : ""}`
        );
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

      return textResult(lines.filter(Boolean).join("\n"));
    } catch (err) {
      return errorResult(
        `Failed to fetch PyPI info: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

export default tool;
