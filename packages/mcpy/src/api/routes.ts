/** REST routes shared by the server and the REST client. */
export const RestRoute = {
  Fetch: "/v1/fetch",
  Grep: "/v1/grep",
  Search: "/v1/search",
} as const;
export type RestRoute = (typeof RestRoute)[keyof typeof RestRoute];

/** MCP tool names. */
export const ToolName = {
  Fetch: "web_fetch",
  Grep: "web_grep",
  Search: "web_search",
} as const;
export type ToolName = (typeof ToolName)[keyof typeof ToolName];
