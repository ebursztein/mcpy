import { z } from "zod";
import type { ToolDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

const tool: ToolDefinition = {
  name: "http_headers",
  category: "web",
  group: "fetch",
  title: "HTTP Headers",
  description:
    "Inspect HTTP response headers from a URL. Useful for checking content types, caching, security headers, redirects, and server info.",
  inputSchema: {
    url: z.string().url().describe("URL to inspect"),
    method: z
      .enum(["HEAD", "GET"])
      .default("HEAD")
      .describe("HTTP method (HEAD is faster, GET for full response headers)"),
  },
  async handler(params) {
    const { url, method } = params as { url: string; method: string };

    try {
      const redirects: string[] = [];
      let currentUrl = url;
      let finalResponse: Response | null = null;

      // Follow redirects manually to track the chain
      for (let i = 0; i < 10; i++) {
        const res = await fetch(currentUrl, {
          method,
          redirect: "manual",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; mcpy/0.1; +https://github.com/mcpy)",
          },
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (location) {
            redirects.push(`${res.status} -> ${location}`);
            currentUrl = new URL(location, currentUrl).href;
            continue;
          }
        }

        finalResponse = res;
        break;
      }

      if (!finalResponse) {
        return errorResult("Too many redirects (>10)");
      }

      const lines: string[] = [
        `URL: ${url}`,
        `Final URL: ${currentUrl}`,
        `Status: ${finalResponse.status} ${finalResponse.statusText}`,
      ];

      if (redirects.length > 0) {
        lines.push("");
        lines.push("Redirect chain:");
        for (const r of redirects) {
          lines.push(`  ${r}`);
        }
      }

      lines.push("");
      lines.push("Headers:");
      const headers = Object.fromEntries(finalResponse.headers.entries());
      for (const [key, value] of Object.entries(headers).sort()) {
        lines.push(`  ${key}: ${value}`);
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `Failed to fetch headers: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

export default tool;
