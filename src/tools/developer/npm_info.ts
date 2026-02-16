import { z } from "zod";
import type { ToolDefinition, GroupDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

export const packagesGroup: GroupDefinition = {
  id: "packages",
  category: "developer",
  label: "Packages",
  description: "Look up npm and PyPI package information",
  requiresConfig: false,
  enabledByDefault: true,
};

const tool: ToolDefinition = {
  name: "npm_info",
  category: "developer",
  group: "packages",
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

    const registryUrl = version
      ? `https://registry.npmjs.org/${encodeURIComponent(package_name)}/${version}`
      : `https://registry.npmjs.org/${encodeURIComponent(package_name)}/latest`;

    try {
      const [pkgRes, downloadsRes] = await Promise.all([
        fetch(registryUrl),
        fetch(
          `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(package_name)}`
        ),
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

      const deps = pkg.dependencies
        ? Object.keys(pkg.dependencies as Record<string, string>)
        : [];
      const devDeps = pkg.devDependencies
        ? Object.keys(pkg.devDependencies as Record<string, string>)
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
        "",
      ];

      if (deps.length > 0) {
        lines.push(
          `Dependencies (${deps.length}): ${deps.slice(0, 20).join(", ")}${deps.length > 20 ? ` ... and ${deps.length - 20} more` : ""}`
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

      return textResult(lines.filter(Boolean).join("\n"));
    } catch (err) {
      return errorResult(
        `Failed to fetch npm info: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

export default tool;
