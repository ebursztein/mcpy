import type { z } from "zod";
import type { Settings } from "../types.ts";
import type { eventBus } from "../events.ts";

export type ToolCategory = "web" | "database" | "developer" | "agent";

export interface ToolContext {
  settings: Settings;
  eventBus: typeof eventBus;
  dataDir: string;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface SettingsFieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "number";
  placeholder?: string;
  gridSpan?: 1 | 2;
}

export interface GroupDefinition {
  id: string;
  category: ToolCategory;
  label: string;
  description: string;
  url?: string;
  remote?: boolean;
  requiresConfig: boolean;
  enabledByDefault: boolean;
  settingsFields?: SettingsFieldDef[];
}

export interface ToolDefinition {
  name: string;
  category: ToolCategory;
  group?: string;
  title: string;
  description: string;
  remote?: boolean;
  inputSchema: Record<string, z.ZodType>;
  handler: (
    params: Record<string, unknown>,
    context: ToolContext
  ) => Promise<ToolResult>;
  requiredSettings?: string[];
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
