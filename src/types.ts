export type EventType =
  | "tool_call"
  | "tool_result"
  | "tool_error"
  | "session_connect"
  | "session_disconnect"
  | "server_start";

export interface McpEvent {
  id: string;
  type: EventType;
  timestamp: string;
  tool?: string;
  category?: string;
  input?: unknown;
  output?: unknown;
  duration?: number;
  error?: string;
  sessionId?: string;
  clientName?: string;
}

export interface SessionInfo {
  sessionId: string;
  clientName: string;
  clientVersion?: string;
  connectedAt: string;
}

export interface ToolStats {
  name: string;
  category: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  lastInvoked: string | null;
  avgDuration: number;
}

export interface ToolInfo {
  name: string;
  category: string;
  group?: string;
  title: string;
  description: string;
  enabled: boolean;
  remote?: boolean;
  requiredSettings?: string[];
  missingSettings?: string[];
}

export interface SettingsFieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "number";
  placeholder?: string;
  gridSpan?: 1 | 2;
}

export interface GroupInfo {
  id: string;
  category: string;
  label: string;
  description: string;
  url?: string;
  remote?: boolean;
  requiresConfig: boolean;
  enabledByDefault: boolean;
  settingsFields?: SettingsFieldDef[];
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface Settings {
  apiKeys: {
    perplexity?: string;
    github?: string;
  };
  database: {
    mysql?: DatabaseConfig;
    postgres?: DatabaseConfig;
  };
  tools: Record<string, { enabled: boolean }>;
}

export interface AggregateStats {
  totalInvocations: number;
  successCount: number;
  errorCount: number;
  tools: Record<string, ToolStats>;
}

export interface TimeseriesPoint {
  timestamp: string;
  tool: string;
  duration: number;
  success: boolean;
}
