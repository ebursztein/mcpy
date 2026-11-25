/** REST routes shared by the server and the REST client. */
export const RestRoute = {
  Fetch: "/v1/fetch",
  Grep: "/v1/grep",
  Search: "/v1/search",
  Papers: "/v1/papers",
  Shopping: "/v1/shopping",
  ShoppingItem: "/v1/shopping/item",
  CryptoMarket: "/v1/crypto/market",
  CryptoCoin: "/v1/crypto/coin",
} as const;
export type RestRoute = (typeof RestRoute)[keyof typeof RestRoute];

/** MCP tool names. */
export const ToolName = {
  Fetch: "web_fetch",
  Grep: "web_grep",
  Search: "web_search",
  Papers: "paper_search",
  Shopping: "shopping_search",
  ShoppingItem: "shopping_item",
  CryptoMarket: "crypto_market",
  CryptoCoin: "crypto_coin",
} as const;
export type ToolName = (typeof ToolName)[keyof typeof ToolName];
