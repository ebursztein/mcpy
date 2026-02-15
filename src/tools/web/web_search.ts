import { z } from "zod";
import type { ToolDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

const tool: ToolDefinition = {
  name: "web_search",
  category: "web",
  group: "perplexity",
  remote: true,
  title: "Web Search",
  description:
    "Search the web using Perplexity AI. Returns an AI-generated answer with citations. Requires a Perplexity API key.",
  inputSchema: {
    query: z.string().describe("Search query"),
    focus: z
      .enum(["internet", "scholar", "news", "writing"])
      .default("internet")
      .describe("Search focus area (default: internet)"),
  },
  requiredSettings: ["apiKeys.perplexity"],
  async handler(params, context) {
    const { query, focus } = params as {
      query: string;
      focus: string;
    };

    const apiKey = context.settings.apiKeys.perplexity;
    if (!apiKey) {
      return errorResult(
        "Perplexity API key not configured. Set it in mcpy settings."
      );
    }

    // Map focus to search_domain_filter or use appropriate model
    const model =
      focus === "scholar"
        ? "sonar-pro"
        : focus === "news"
          ? "sonar"
          : "sonar";

    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: query,
            },
          ],
          ...(focus === "scholar" && {
            search_domain_filter: [
              "scholar.google.com",
              "arxiv.org",
              "pubmed.ncbi.nlm.nih.gov",
            ],
          }),
          ...(focus === "news" && {
            search_recency_filter: "week",
          }),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return errorResult(`Perplexity API error (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
        citations?: string[];
      };

      const answer = data.choices?.[0]?.message?.content;
      if (!answer) {
        return errorResult("No response from Perplexity API");
      }

      const lines = [answer];

      if (data.citations && data.citations.length > 0) {
        lines.push("");
        lines.push("Sources:");
        for (const [i, citation] of data.citations.entries()) {
          lines.push(`  [${i + 1}] ${citation}`);
        }
      }

      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(
        `Search failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};

export default tool;
