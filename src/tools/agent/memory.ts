import { z } from "zod";
import { join } from "path";
import type { ToolDefinition, GroupDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

export const memoryGroup: GroupDefinition = {
  id: "memory",
  category: "agent",
  label: "Memory",
  description: "Key-value store for facts and preferences across sessions",
  requiresConfig: false,
  enabledByDefault: true,
};

interface MemoryEntry {
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

async function loadMemory(dataDir: string): Promise<MemoryEntry[]> {
  const file = Bun.file(join(dataDir, "memory.json"));
  if (await file.exists()) {
    try {
      return await file.json();
    } catch {
      return [];
    }
  }
  return [];
}

async function saveMemory(
  dataDir: string,
  entries: MemoryEntry[]
): Promise<void> {
  await Bun.write(
    join(dataDir, "memory.json"),
    JSON.stringify(entries, null, 2)
  );
}

const tool: ToolDefinition = {
  name: "memory",
  category: "agent",
  group: "memory",
  title: "Memory Store",
  description:
    "Persistent key-value memory store. Use to remember facts, preferences, and context across conversations. Supports get, set, delete, list, and search actions.",
  inputSchema: {
    action: z
      .enum(["get", "set", "delete", "list", "search"])
      .describe("Action to perform"),
    key: z
      .string()
      .optional()
      .describe("Memory key (for get/set/delete)"),
    value: z.string().optional().describe("Value to store (for set)"),
    query: z
      .string()
      .optional()
      .describe("Search query (for search, matches keys and values)"),
  },
  async handler(params, context) {
    const { action, key, value, query } = params as {
      action: string;
      key?: string;
      value?: string;
      query?: string;
    };

    const entries = await loadMemory(context.dataDir);

    switch (action) {
      case "get": {
        if (!key) return errorResult("'key' is required for get action");
        const entry = entries.find((e) => e.key === key);
        if (!entry) return textResult(`No memory found for key "${key}"`);
        return textResult(entry.value);
      }

      case "set": {
        if (!key) return errorResult("'key' is required for set action");
        if (!value) return errorResult("'value' is required for set action");
        const existing = entries.find((e) => e.key === key);
        const now = new Date().toISOString();
        if (existing) {
          existing.value = value;
          existing.updated_at = now;
        } else {
          entries.push({ key, value, created_at: now, updated_at: now });
        }
        await saveMemory(context.dataDir, entries);
        return textResult(`Stored: ${key} = ${value}`);
      }

      case "delete": {
        if (!key) return errorResult("'key' is required for delete action");
        const idx = entries.findIndex((e) => e.key === key);
        if (idx === -1)
          return errorResult(`No memory found for key "${key}"`);
        entries.splice(idx, 1);
        await saveMemory(context.dataDir, entries);
        return textResult(`Deleted memory for key "${key}"`);
      }

      case "list": {
        if (entries.length === 0) return textResult("No memories stored.");
        const lines = entries.map((e) => `- ${e.key}: ${e.value}`);
        return textResult(lines.join("\n"));
      }

      case "search": {
        if (!query)
          return errorResult("'query' is required for search action");
        const q = query.toLowerCase();
        const matches = entries.filter(
          (e) =>
            e.key.toLowerCase().includes(q) ||
            e.value.toLowerCase().includes(q)
        );
        if (matches.length === 0)
          return textResult(`No memories matching "${query}"`);
        const lines = matches.map((e) => `- ${e.key}: ${e.value}`);
        return textResult(
          `Found ${matches.length} result(s):\n${lines.join("\n")}`
        );
      }

      default:
        return errorResult(`Unknown action: ${action}`);
    }
  },
};

export default tool;
