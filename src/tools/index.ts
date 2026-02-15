import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition, ToolContext } from "./base.ts";
import { eventBus, makeEventId } from "../events.ts";
import { getSettingValue, DATA_DIR } from "../settings.ts";
import type { Settings, ToolInfo } from "../types.ts";

// Explicit imports -- works in both dev and compiled binary
import todoList from "./agent/todo_list.ts";
import memory from "./agent/memory.ts";
import npmInfo from "./developer/npm_info.ts";
import pypiInfo from "./developer/pypi_info.ts";
import { mcpyLog, mcpyRestart, mcpyStats } from "./debug/mcpy.ts";
import webFetch from "./web/web_fetch.ts";
import httpHeaders from "./web/http_headers.ts";
import webSearch from "./web/web_search.ts";
import { mysqlQuery, mysqlListTables, mysqlDescribeTable } from "./database/mysql.ts";
import { postgresQuery, postgresListTables, postgresDescribeTable } from "./database/postgres.ts";

const ALL_TOOLS: ToolDefinition[] = [
  todoList,
  memory,
  npmInfo,
  pypiInfo,
  mcpyLog,
  mcpyRestart,
  mcpyStats,
  webFetch,
  httpHeaders,
  webSearch,
  mysqlQuery,
  mysqlListTables,
  mysqlDescribeTable,
  postgresQuery,
  postgresListTables,
  postgresDescribeTable,
];

// All discovered tools (enabled or not)
const registry = new Map<string, ToolDefinition>();

function hasRequiredSettings(tool: ToolDefinition, settings: Settings): boolean {
  if (!tool.requiredSettings) return true;
  return tool.requiredSettings.every(
    (path) => !!getSettingValue(settings, path)
  );
}

function isToolEnabled(tool: ToolDefinition, settings: Settings): boolean {
  const explicit = settings.tools[tool.name];
  if (explicit !== undefined) return explicit.enabled;
  // Default: disabled if missing required settings, enabled otherwise
  return hasRequiredSettings(tool, settings);
}

export async function discoverTools(): Promise<Map<string, ToolDefinition>> {
  for (const tool of ALL_TOOLS) {
    if (tool?.name && tool?.handler) {
      registry.set(tool.name, tool);
    }
  }
  return registry;
}

export async function registerTools(
  server: McpServer,
  settings: Settings
): Promise<void> {
  const context: ToolContext = {
    settings,
    eventBus,
    dataDir: DATA_DIR,
  };

  for (const [name, tool] of registry) {
    if (!isToolEnabled(tool, settings)) continue;

    server.registerTool(
      name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (params: Record<string, unknown>) => {
        const callId = makeEventId();
        const startTime = Date.now();

        eventBus.emit({
          id: callId,
          type: "tool_call",
          timestamp: new Date().toISOString(),
          tool: name,
          category: tool.category,
          input: params,
        });

        try {
          // Check required settings
          if (tool.requiredSettings) {
            for (const settingPath of tool.requiredSettings) {
              const val = getSettingValue(context.settings, settingPath);
              if (!val) {
                const result = {
                  content: [
                    {
                      type: "text" as const,
                      text: `Missing required setting: ${settingPath}. Please configure it in the mcpy settings UI at http://localhost:${process.env.PORT || 3713}/settings`,
                    },
                  ],
                  isError: true,
                };
                eventBus.emit({
                  id: makeEventId(),
                  type: "tool_error",
                  timestamp: new Date().toISOString(),
                  tool: name,
                  category: tool.category,
                  error: `Missing setting: ${settingPath}`,
                  duration: Date.now() - startTime,
                });
                return result;
              }
            }
          }

          const result = await tool.handler(params, context);

          eventBus.emit({
            id: makeEventId(),
            type: "tool_result",
            timestamp: new Date().toISOString(),
            tool: name,
            category: tool.category,
            duration: Date.now() - startTime,
          });

          return result;
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : String(err);

          eventBus.emit({
            id: makeEventId(),
            type: "tool_error",
            timestamp: new Date().toISOString(),
            tool: name,
            category: tool.category,
            error: errorMsg,
            duration: Date.now() - startTime,
          });

          return {
            content: [{ type: "text" as const, text: `Error: ${errorMsg}` }],
            isError: true,
          };
        }
      }
    );
  }
}

export function getToolInfoList(settings: Settings): ToolInfo[] {
  const tools: ToolInfo[] = [];

  for (const [name, tool] of registry) {
    const enabled = isToolEnabled(tool, settings);
    const missingSettings: string[] = [];

    if (tool.requiredSettings) {
      for (const path of tool.requiredSettings) {
        if (!getSettingValue(settings, path)) {
          missingSettings.push(path);
        }
      }
    }

    tools.push({
      name,
      category: tool.category,
      group: tool.group,
      title: tool.title,
      description: tool.description,
      enabled,
      remote: tool.remote,
      requiredSettings: tool.requiredSettings,
      missingSettings: missingSettings.length > 0 ? missingSettings : undefined,
    });
  }

  return tools;
}

export function getRegistry(): Map<string, ToolDefinition> {
  return registry;
}
