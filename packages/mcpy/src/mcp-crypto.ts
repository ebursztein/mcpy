/** The crypto MCP tools (crypto_market, crypto_coin): mounted by registerMcpyTools, rendered here. */

import type { McpServer } from "@modelcontextprotocol/server";
import { ToolName } from "./api/routes.js";
import { toMcpyError } from "./errors.js";
import type { McpyApi } from "./schemas.js";
import {
  CryptoCoinInputSchema,
  CryptoCoinResultSchema,
  CryptoMarketInputSchema,
  CryptoMarketResultSchema,
  MAX_COIN_ROWS,
  type CoinDay,
  type CryptoCoinResult,
  type CryptoMarketResult,
  type MarketCoin,
} from "./schemas-crypto.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

/** Numbers as an LLM reads them best: money with $, big ones grouped, tiny ones in exponent form. */
function n(v: number | undefined, unit = ""): string | undefined {
  if (v === undefined) return undefined;
  const abs = Math.abs(v);
  const text = abs !== 0 && (abs < 0.01 || abs >= 1e15) ? v.toExponential(4) : abs >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Number(v.toPrecision(6)));
  return unit === "$" ? `$${text}` : `${text}${unit}`;
}

const facts = (pairs: [string, string | undefined][]) => pairs.flatMap(([k, v]) => (v === undefined ? [] : [`${k} ${v}`])).join(" · ");

function marketLine(c: MarketCoin): string {
  return `${c.symbol} (${c.name})${c.algorithm ? `, ${c.algorithm}` : ""}: ` +
    facts([
      ["price", n(c.price_usd, "$")],
      ["7d", n(c.price_change_7d_pct, "%")],
      ["cap", n(c.market_cap_usd, "$")],
      ["vol 24h", n(c.volume_24h_usd, "$")],
      ["hashrate", n(c.network_hashrate_hs, " H/s")],
      ["diff", n(c.difficulty)],
      ["hashprice", n(c.hashprice_usd_per_hs_day, " $/(H/s·day)")],
    ]);
}

export function renderCryptoMarket(r: CryptoMarketResult): string {
  const head = facts([
    ["total cap", n(r.total_market_cap_usd, "$")],
    ["vol 24h", n(r.total_volume_24h_usd, "$")],
    ["BTC dominance", n(r.btc_dominance_pct, "%")],
  ]);
  const missing = r.missing.length ? `\nNo source knows: ${r.missing.join(", ")}` : "";
  return `Crypto market at ${r.as_of} (cache: ${r.meta.cache})${head ? `\n${head}` : ""}\n---\n${r.coins.map(marketLine).join("\n") || "No coins."}${missing}`;
}

function dayLine(d: CoinDay): string {
  return `${d.date} ${d.status}: ` +
    facts([
      ["price", n(d.price_usd, "$")],
      ["hashrate", n(d.network_hashrate_hs, " H/s")],
      ["diff", n(d.difficulty)],
      ["blocks", n(d.blocks)],
      ["miner coins", d.miner_subsidy_coins !== undefined ? n(d.miner_subsidy_coins + (d.miner_fees_coins ?? 0)) : undefined],
      ["hashprice", n(d.hashprice_usd_per_hs_day, " $/(H/s·day)")],
    ]);
}

export function renderCryptoCoin(r: CryptoCoinResult): string {
  const coins = r.coins.map((c) => `${c.symbol} (${c.name})${c.algorithm ? `, ${c.algorithm}` : ""}\n${c.days.map(dayLine).join("\n")}`).join("\n\n");
  const missing = r.missing.length ? `\nNo source knows: ${r.missing.join(", ")}` : "";
  return `${coins || "No coins."}${missing}\n(cache: ${r.meta.cache}; every field is in structuredContent)`;
}

export function registerCryptoTools(server: McpServer, api: McpyApi): void {
  const fail = (err: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(toMcpyError(err).toJSON()) }], isError: true });
  server.registerTool(
    ToolName.CryptoMarket,
    {
      title: "Crypto Market",
      description:
        "The crypto market now: total market cap, 24h volume, BTC dominance, and per coin price, 7-day change, market cap, volume, network hashrate, difficulty and hashprice (USD a day per H/s). Default: the 40 largest coins; or pass symbols. Answers are at most 5 minutes old.",
      inputSchema: CryptoMarketInputSchema,
      outputSchema: CryptoMarketResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.cryptoMarket(input).then((r) => ({ content: [{ type: "text" as const, text: renderCryptoMarket(r) }], structuredContent: r as unknown as Record<string, unknown> }), fail),
  );
  server.registerTool(
    ToolName.CryptoCoin,
    {
      title: "Crypto Coin",
      description:
        `A few coins day by day: price, market cap, supply, volume, network hashrate, difficulty, blocks, new coins, fees, transactions, what miners received and hashprice. Each day is complete (over, final) or live (today). days counts back from today; or pass from/to (YYYY-MM-DD) for older history. At most ${MAX_COIN_ROWS} day rows a call (coins × days).`,
      inputSchema: CryptoCoinInputSchema,
      outputSchema: CryptoCoinResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.cryptoCoin(input).then((r) => ({ content: [{ type: "text" as const, text: renderCryptoCoin(r) }], structuredContent: r as unknown as Record<string, unknown> }), fail),
  );
}
