import { z } from "zod";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ToolDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

const tool: ToolDefinition = {
  name: "web_fetch",
  category: "web",
  group: "fetch",
  title: "Web Fetch",
  description:
    'Fetch a webpage and extract its content. Use mode "content" for clean readable text (default) or "raw_html" for raw HTML. Supports pagination with start_index/max_length to avoid returning too much content at once.',
  inputSchema: {
    url: z.string().url().describe("URL to fetch"),
    mode: z
      .enum(["content", "raw_html"])
      .default("content")
      .describe('Extraction mode: "content" (clean text) or "raw_html"'),
    start_index: z
      .number()
      .default(0)
      .describe("Character offset to start from (for pagination)"),
    max_length: z
      .number()
      .default(5000)
      .describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params) {
    const { url, mode, start_index, max_length } = params as {
      url: string;
      mode: string;
      start_index: number;
      max_length: number;
    };

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; mcpy/0.1; +https://github.com/mcpy)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      if (!res.ok) {
        return errorResult(`HTTP ${res.status}: ${res.statusText}`);
      }

      const html = await res.text();

      if (mode === "raw_html") {
        const total = html.length;
        const chunk = html.slice(start_index, start_index + max_length);
        const hasMore = start_index + max_length < total;

        const meta = [
          `URL: ${url}`,
          `Total length: ${total} chars`,
          `Showing: ${start_index}-${start_index + chunk.length}`,
          hasMore
            ? `Has more: true (use start_index=${start_index + max_length} to continue)`
            : "Has more: false",
          "---",
        ].join("\n");

        return textResult(meta + "\n" + chunk);
      }

      // Content mode: use Readability
      const { document } = parseHTML(html);

      // Set documentURI for Readability
      Object.defineProperty(document, "documentURI", {
        value: url,
        writable: false,
      });

      const reader = new Readability(document);
      const article = reader.parse();

      if (!article || !article.textContent) {
        // Fallback: extract text from body
        const bodyText =
          document.body?.textContent?.trim() || "No content extracted";
        const total = bodyText.length;
        const chunk = bodyText.slice(start_index, start_index + max_length);
        const hasMore = start_index + max_length < total;

        return textResult(
          [
            `URL: ${url}`,
            `Title: ${document.title || "unknown"}`,
            `Total length: ${total} chars`,
            hasMore
              ? `Has more: true (use start_index=${start_index + max_length} to continue)`
              : "Has more: false",
            "---",
            chunk,
          ].join("\n")
        );
      }

      const content = article.textContent.trim();
      const total = content.length;
      const chunk = content.slice(start_index, start_index + max_length);
      const hasMore = start_index + max_length < total;

      const meta = [
        `URL: ${url}`,
        `Title: ${article.title || "unknown"}`,
        article.byline ? `Author: ${article.byline}` : "",
        article.excerpt ? `Excerpt: ${article.excerpt.slice(0, 200)}` : "",
        `Total length: ${total} chars`,
        `Showing: ${start_index}-${start_index + chunk.length}`,
        hasMore
          ? `Has more: true (use start_index=${start_index + max_length} to continue)`
          : "Has more: false",
        "---",
      ]
        .filter(Boolean)
        .join("\n");

      return textResult(meta + "\n" + chunk);
    } catch (err) {
      return errorResult(
        `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

export default tool;
