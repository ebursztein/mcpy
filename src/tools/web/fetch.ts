import { z } from "zod";
import { join } from "path";
import { mkdirSync } from "fs";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ToolDefinition, ToolContext, GroupDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";
import { paginate, paginationHeader } from "../lib/paginate.ts";
import { grepLines } from "../lib/grep.ts";

export const fetchGroup: GroupDefinition = {
  id: "fetch",
  category: "web",
  label: "Fetch",
  description: "Fetch web pages, inspect headers, and grep content",
  requiresConfig: false,
  enabledByDefault: true,
};

const UA = "Mozilla/5.0 (compatible; mcpy/0.1; +https://github.com/mcpy)";

interface FetchResult {
  body: string;
  contentType: string;
  isHtml: boolean;
}

async function fetchPage(url: string): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "";
  const isHtml = /text\/html|application\/xhtml/i.test(contentType);
  return { body: await res.text(), contentType, isHtml };
}

function extractContent(html: string, url: string): { title: string; byline?: string; excerpt?: string; text: string } {
  const { document } = parseHTML(html);
  Object.defineProperty(document, "documentURI", { value: url, writable: false });

  const reader = new Readability(document);
  const article = reader.parse();

  if (article?.textContent) {
    return {
      title: article.title || document.title || "unknown",
      byline: article.byline || undefined,
      excerpt: article.excerpt || undefined,
      text: article.textContent.trim(),
    };
  }

  const bodyText = document.body?.textContent?.trim() || "No content extracted";
  return { title: document.title || "unknown", text: bodyText };
}

// --- web_fetch_text: clean readable text ---

export const webFetchText: ToolDefinition = {
  name: "web_fetch_text",
  category: "web",
  group: "fetch",
  title: "Web Fetch",
  description:
    "Fetch a webpage and extract its content as clean readable text using Mozilla Readability. Best for articles, docs, and text-heavy pages. Supports pagination with start_index/max_length.",
  inputSchema: {
    url: z.string().url().describe("URL to fetch"),
    start_index: z.number().default(0).describe("Character offset to start from (for pagination)"),
    max_length: z.number().default(5000).describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params) {
    const { url, start_index, max_length } = params as { url: string; start_index: number; max_length: number };

    try {
      const page = await fetchPage(url);

      let content: string;
      let title = "unknown";
      let byline: string | undefined;
      let excerpt: string | undefined;

      if (page.isHtml) {
        const article = extractContent(page.body, url);
        content = article.text;
        title = article.title;
        byline = article.byline;
        excerpt = article.excerpt;
      } else {
        content = page.body;
      }

      const { chunk, total, hasMore } = paginate(content, start_index, max_length);

      const meta = [
        `URL: ${url}`,
        page.isHtml ? `Title: ${title}` : `Content-Type: ${page.contentType}`,
        byline ? `Author: ${byline}` : "",
        excerpt ? `Excerpt: ${excerpt.slice(0, 200)}` : "",
        `Total length: ${total} chars`,
        `Showing: ${start_index}-${start_index + chunk.length}`,
        hasMore ? `Has more: true (use start_index=${start_index + max_length} to continue)` : "Has more: false",
        "---",
      ].filter(Boolean).join("\n");

      return textResult(meta + "\n" + chunk);
    } catch (err) {
      return errorResult(`Failed to fetch: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// --- web_fetch_raw: raw HTML ---

export const webFetchRaw: ToolDefinition = {
  name: "web_fetch_raw",
  category: "web",
  group: "fetch",
  title: "Web Fetch Raw",
  description:
    "Fetch a webpage and return the raw HTML. Useful for inspecting page structure, scripts, or non-article content. Supports pagination with start_index/max_length.",
  inputSchema: {
    url: z.string().url().describe("URL to fetch"),
    start_index: z.number().default(0).describe("Character offset to start from (for pagination)"),
    max_length: z.number().default(5000).describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params) {
    const { url, start_index, max_length } = params as { url: string; start_index: number; max_length: number };

    try {
      const page = await fetchPage(url);
      const { chunk, total, hasMore } = paginate(page.body, start_index, max_length);

      const meta = [
        `URL: ${url}`,
        `Total length: ${total} chars`,
        `Showing: ${start_index}-${start_index + chunk.length}`,
        hasMore ? `Has more: true (use start_index=${start_index + max_length} to continue)` : "Has more: false",
        "---",
      ].join("\n");

      return textResult(meta + "\n" + chunk);
    } catch (err) {
      return errorResult(`Failed to fetch: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// --- web_http_headers: inspect response headers ---

export const webHttpHeaders: ToolDefinition = {
  name: "web_http_headers",
  category: "web",
  group: "fetch",
  title: "HTTP Headers",
  description:
    "Inspect HTTP response headers from a URL. Useful for checking content types, caching, security headers, redirects, and server info. Output is capped at max_length characters.",
  inputSchema: {
    url: z.string().url().describe("URL to inspect"),
    method: z.enum(["HEAD", "GET"]).default("HEAD").describe("HTTP method (HEAD is faster, GET for full response headers)"),
    start_index: z.number().default(0).describe("Character offset to start from (for pagination)"),
    max_length: z.number().default(5000).describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params) {
    const { url, method, start_index, max_length } = params as { url: string; method: string; start_index: number; max_length: number };

    try {
      const redirects: string[] = [];
      let currentUrl = url;
      let finalResponse: Response | null = null;

      for (let i = 0; i < 10; i++) {
        const res = await fetch(currentUrl, {
          method,
          redirect: "manual",
          headers: { "User-Agent": UA },
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
        lines.push("", "Redirect chain:");
        for (const r of redirects) {
          lines.push(`  ${r}`);
        }
      }

      lines.push("", "Headers:");
      const headers = Object.fromEntries(finalResponse.headers.entries());
      for (const [key, value] of Object.entries(headers).sort()) {
        lines.push(`  ${key}: ${value}`);
      }

      const full = lines.join("\n");
      const { chunk, total, hasMore } = paginate(full, start_index, max_length);

      if (start_index > 0 || hasMore) {
        return textResult(paginationHeader(start_index, chunk, total, hasMore, max_length) + "\n" + chunk);
      }

      return textResult(chunk);
    } catch (err) {
      return errorResult(`Failed to fetch headers: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// --- web_grep: fetch + regex search with context ---

export const webGrep: ToolDefinition = {
  name: "web_grep",
  category: "web",
  group: "fetch",
  title: "Web Grep",
  description:
    "Fetch a webpage, extract readable text, and search for a regex pattern. Returns matching lines with surrounding context. Much more efficient than fetching an entire page when you know what you are looking for. Output is capped at max_length characters.",
  inputSchema: {
    url: z.string().url().describe("URL to fetch"),
    pattern: z.string().describe("Regex pattern to search for (case-insensitive)"),
    context_lines: z.number().default(3).describe("Number of lines to show before and after each match (default: 3)"),
    max_matches: z.number().default(10).describe("Maximum number of matches to return (default: 10)"),
    raw: z.boolean().default(false).describe("Search raw HTML instead of extracted readable text (default: false)"),
    start_index: z.number().default(0).describe("Character offset to start from (for pagination)"),
    max_length: z.number().default(5000).describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params) {
    const { url, pattern, context_lines, max_matches, raw, start_index, max_length } = params as {
      url: string; pattern: string; context_lines: number; max_matches: number; raw: boolean; start_index: number; max_length: number;
    };

    try {
      const page = await fetchPage(url);

      let text: string;
      let title: string;
      if (raw || !page.isHtml) {
        text = page.body;
        title = raw ? "(raw)" : `(${page.contentType})`;
      } else {
        const article = extractContent(page.body, url);
        text = article.text;
        title = article.title;
      }
      const lines = text.split("\n");

      let result;
      try {
        result = grepLines(lines, pattern, context_lines, max_matches);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      if (result.matches === 0) {
        return textResult(`URL: ${url}\nTitle: ${title}\n\nNo matches for pattern: ${pattern}`);
      }

      const header = [
        `URL: ${url}`,
        `Title: ${title}`,
        `Matches: ${result.matches}${result.capped ? ` (capped at ${max_matches})` : ""}`,
        `Total lines: ${lines.length}`,
        "---",
      ].join("\n");

      const full = header + "\n" + result.output;
      const { chunk, total, hasMore } = paginate(full, start_index, max_length);

      if (start_index > 0 || hasMore) {
        return textResult(paginationHeader(start_index, chunk, total, hasMore, max_length) + "\n" + chunk);
      }

      return textResult(chunk);
    } catch (err) {
      return errorResult(`Failed to grep: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// --- web_fetch_binary: download file to disk ---

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export const webFetchBinary: ToolDefinition = {
  name: "web_fetch_binary",
  category: "web",
  group: "fetch",
  title: "Web Fetch Binary",
  description:
    "Download a file from a URL to ~/.mcpy/downloads/. Returns the local file path, size, and content type. Use for PDFs, images, archives, or any non-text content.",
  inputSchema: {
    url: z.string().url().describe("URL to download"),
    filename: z.string().optional().describe("Optional filename for the downloaded file (default: derived from URL)"),
  },
  async handler(params, context) {
    const { url, filename } = params as { url: string; filename?: string };

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        redirect: "follow",
      });

      if (!res.ok) {
        return errorResult(`HTTP ${res.status}: ${res.statusText}`);
      }

      const contentType = res.headers.get("content-type") || "application/octet-stream";
      const bytes = await res.arrayBuffer();

      // Determine filename
      let outName = filename;
      if (!outName) {
        // Try Content-Disposition header
        const disposition = res.headers.get("content-disposition");
        if (disposition) {
          const match = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
          if (match) outName = match[1].trim();
        }
      }
      if (!outName) {
        // Derive from URL path
        const urlPath = new URL(url).pathname;
        outName = urlPath.split("/").pop() || "download";
        // Strip query params that leaked into the filename
        outName = outName.split("?")[0];
      }

      // Ensure downloads directory exists
      const downloadsDir = join(context.dataDir, "downloads");
      mkdirSync(downloadsDir, { recursive: true });

      // Avoid overwriting: append timestamp if file exists
      let outPath = join(downloadsDir, outName);
      const file = Bun.file(outPath);
      if (await file.exists()) {
        const ext = outName.includes(".") ? "." + outName.split(".").pop() : "";
        const base = ext ? outName.slice(0, -ext.length) : outName;
        outPath = join(downloadsDir, `${base}-${Date.now()}${ext}`);
      }

      await Bun.write(outPath, bytes);

      return textResult([
        `Downloaded: ${outPath}`,
        `URL: ${url}`,
        `Size: ${formatBytes(bytes.byteLength)}`,
        `Content-Type: ${contentType}`,
      ].join("\n"));
    } catch (err) {
      return errorResult(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

export default webFetchText;
