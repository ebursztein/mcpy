import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition, ToolContext, GroupDefinition } from "./base.ts";
import { eventBus, makeEventId } from "../events.ts";
import { getSettingValue, DATA_DIR } from "../settings.ts";
import type { Settings, ToolInfo, GroupInfo } from "../types.ts";

// Explicit imports -- works in both dev and compiled binary
import {
  notesAdd, notesRead, notesDelete, notesSearch, notesGrep,
  notesList, notesUpdateMetadata, notesUpdateContent,
} from "./agent/notes.ts";
import { npmInfo, npmSearch, npmVersions, npmReadme } from "./developer/npm.ts";
import { pypiInfo, pypiVersions, pypiReadme } from "./developer/pypi.ts";
import { mcpyLog, mcpyRestart, mcpyStats, mcpyUpdate } from "./debug/mcpy.ts";
import { webFetchText, webFetchRaw, webHttpHeaders, webGrep, webFetchBinary } from "./web/fetch.ts";
import perplexitySearch from "./web/perplexity.ts";
import { mysqlQuery, mysqlListTables, mysqlDescribeTable } from "./database/mysql.ts";
import { postgresQuery, postgresListTables, postgresDescribeTable } from "./database/postgres.ts";
import { githubSearch, githubFile, githubGrep } from "./developer/github.ts";

// Group definitions
import { notesGroup } from "./agent/notes.ts";
import { npmGroup } from "./developer/npm.ts";
import { pypiGroup } from "./developer/pypi.ts";
import { mcpyGroup } from "./debug/mcpy.ts";
import { fetchGroup } from "./web/fetch.ts";
import { perplexityGroup } from "./web/perplexity.ts";
import { mysqlGroup } from "./database/mysql.ts";
import { postgresGroup } from "./database/postgres.ts";
import { githubGroup } from "./developer/github.ts";

const ALL_TOOLS: ToolDefinition[] = [
  notesAdd,
  notesRead,
  notesDelete,
  notesSearch,
  notesGrep,
  notesList,
  notesUpdateMetadata,
  notesUpdateContent,
  npmInfo,
  npmSearch,
  npmVersions,
  npmReadme,
  pypiInfo,
  pypiVersions,
  pypiReadme,
  mcpyLog,
  mcpyRestart,
  mcpyStats,
  mcpyUpdate,
  webFetchText,
  webFetchRaw,
  webHttpHeaders,
  webGrep,
  webFetchBinary,
  perplexitySearch,
  mysqlQuery,
  mysqlListTables,
  mysqlDescribeTable,
  postgresQuery,
  postgresListTables,
  postgresDescribeTable,
  githubSearch,
  githubFile,
  githubGrep,
];

export const ALL_GROUPS: GroupDefinition[] = [
  notesGroup,
  npmGroup,
  pypiGroup,
  mcpyGroup,
  fetchGroup,
  perplexityGroup,
  mysqlGroup,
  postgresGroup,
  githubGroup,
];

// All discovered tools (enabled or not)
const registry = new Map<string, ToolDefinition>();
const groupRegistry = new Map<string, GroupDefinition>();

function hasRequiredSettings(tool: ToolDefinition, settings: Settings): boolean {
  if (!tool.requiredSettings) return true;
  return tool.requiredSettings.every(
    (path) => !!getSettingValue(settings, path)
  );
}

function isToolEnabled(tool: ToolDefinition, settings: Settings): boolean {
  // Explicit per-tool toggle always wins
  const explicit = settings.tools[tool.name];
  if (explicit !== undefined) return explicit.enabled && hasRequiredSettings(tool, settings);

  const group = tool.group ? groupRegistry.get(tool.group) : undefined;

  // Tools with required settings: auto-enable once configured, regardless of enabledByDefault
  if (tool.requiredSettings && tool.requiredSettings.length > 0) {
    return hasRequiredSettings(tool, settings);
  }

  // No required settings: use group default
  if (group) return group.enabledByDefault;
  return true;
}

export async function discoverTools(): Promise<Map<string, ToolDefinition>> {
  for (const group of ALL_GROUPS) {
    groupRegistry.set(group.id, group);
  }
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

export function getGroupInfoList(): GroupInfo[] {
  return Array.from(groupRegistry.values()).map((g) => ({
    id: g.id,
    category: g.category,
    label: g.label,
    description: g.description,
    url: g.url,
    remote: g.remote,
    requiresConfig: g.requiresConfig,
    enabledByDefault: g.enabledByDefault,
    settingsFields: g.settingsFields,
  }));
}

export function getRegistry(): Map<string, ToolDefinition> {
  return registry;
}
