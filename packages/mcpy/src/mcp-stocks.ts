/** The stock MCP tools (stock_quote, stock_history, stock_fundamentals): mounted by registerMcpyTools, rendered here. */

import type { McpServer } from "@modelcontextprotocol/server";
import { ToolName } from "./api/routes.js";
import { toMcpyError } from "./errors.js";
import type { McpyApi } from "./schemas.js";
import {
  MAX_HISTORY_BARS,
  MAX_QUOTE_SYMBOLS,
  StockFundamentalsInputSchema,
  StockFundamentalsResultSchema,
  StockHistoryInputSchema,
  StockHistoryResultSchema,
  StockQuoteInputSchema,
  StockQuoteResultSchema,
  type StockFundamentalsResult,
  type StockHistoryResult,
  type StockQuote,
  type StockQuoteResult,
} from "./schemas-stocks.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

/** Big numbers grouped, small ones as they are. */
function n(v: number | undefined, unit = ""): string | undefined {
  if (v === undefined) return undefined;
  const abs = Math.abs(v);
  const text = abs >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : abs >= 10_000 ? Math.round(v).toLocaleString("en-US") : String(Number(v.toPrecision(6)));
  return `${text}${unit}`;
}

const facts = (pairs: [string, string | undefined][]) => pairs.flatMap(([k, v]) => (v === undefined ? [] : [`${k} ${v}`])).join(" · ");

function quoteLine(q: StockQuote): string {
  const change = q.change_pct !== undefined ? ` ${q.change_pct >= 0 ? "+" : ""}${n(q.change_pct)}%` : "";
  const range = q.fifty_two_week_low !== undefined && q.fifty_two_week_high !== undefined ? `${n(q.fifty_two_week_low)}-${n(q.fifty_two_week_high)}` : undefined;
  const more = facts([["prev", n(q.previous_close)], ["vol", n(q.volume)], ["52w", range]]);
  return `${q.symbol}${q.name ? ` (${q.name})` : ""}: ${n(q.price)}${q.currency ? ` ${q.currency}` : ""}${change} on ${q.market_date}${more ? ` · ${more}` : ""}`;
}

export function renderStockQuote(r: StockQuoteResult): string {
  const missing = r.missing.length ? `\nNo source knows: ${r.missing.join(", ")}` : "";
  return `${r.quotes.map(quoteLine).join("\n") || "No quotes."}${missing}\n(cache: ${r.meta.cache})`;
}

export function renderStockHistory(r: StockHistoryResult): string {
  const head = `${r.symbol}${r.name ? ` (${r.name})` : ""}, ${r.interval} bars ${r.from} to ${r.to}${r.currency ? `, ${r.currency}` : ""}`;
  const rows = r.bars.map((b) => `${b.date} o ${n(b.open) ?? "-"} h ${n(b.high) ?? "-"} l ${n(b.low) ?? "-"} c ${n(b.close)}${b.volume !== undefined ? ` v ${n(b.volume)}` : ""}`);
  const events = [...(r.dividends ?? []).map((d) => `${d.date} dividend ${d.amount}`), ...(r.splits ?? []).map((s) => `${s.date} split ${s.ratio}`)];
  return `${head}\n${rows.join("\n") || "No bars."}${events.length ? `\n${events.join("\n")}` : ""}\n(cache: ${r.meta.cache}; adj_close is in structuredContent)`;
}

export function renderStockFundamentals(r: StockFundamentalsResult): string {
  const head = `${r.symbol}${r.name ? ` (${r.name})` : ""}${r.shares_outstanding !== undefined ? `: ${n(r.shares_outstanding)} shares on ${r.shares_outstanding_as_of}` : ""}`;
  const years = r.years.map(
    (y) =>
      `FY ending ${y.period_end}: ` +
      facts([
        ["revenue", n(y.revenue_usd, " USD")],
        ["net income", n(y.net_income_usd, " USD")],
        ["EPS", n(y.eps_diluted_usd)],
        ["FCF", n(y.free_cash_flow_usd, " USD")],
        ["equity", n(y.equity_usd, " USD")],
      ]),
  );
  const b = r.latest_balance_sheet;
  const balance = b ? `\nBalance sheet ${b.as_of}: ${facts([["assets", n(b.assets_usd, " USD")], ["cash", n(b.cash_usd, " USD")], ["long-term debt", n(b.long_term_debt_usd, " USD")]])}` : "";
  return `${head}\n${years.join("\n") || "No fiscal years."}${balance}\n(cache: ${r.meta.cache}; every field is in structuredContent)`;
}

export function registerStockTools(server: McpServer, api: McpyApi): void {
  const fail = (err: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(toMcpyError(err).toJSON()) }], isError: true });
  const answer = <R>(render: (r: R) => string) => (r: R) => ({ content: [{ type: "text" as const, text: render(r) }], structuredContent: r as unknown as Record<string, unknown> });
  server.registerTool(
    ToolName.StockQuote,
    {
      title: "Stock Quote",
      description:
        `Latest price of up to ${MAX_QUOTE_SYMBOLS} stocks, ETFs, funds, indices (^GSPC), currencies (EURUSD=X) or crypto pairs (BTC-USD): price, change since the previous close, day range, volume and 52-week range. Most exchanges (SAP.DE, 7203.T). Answers are at most max_age seconds old (default 60).`,
      inputSchema: StockQuoteInputSchema,
      outputSchema: StockQuoteResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.stockQuote(input).then(answer(renderStockQuote), fail),
  );
  server.registerTool(
    ToolName.StockHistory,
    {
      title: "Stock History",
      description: `One symbol's price history: open, high, low, close, adjusted close and volume per day, week or month, with dividends and splits. from/to are YYYY-MM-DD (default the last 30 days); at most ${MAX_HISTORY_BARS} bars a call, so use week or month bars for long ranges.`,
      inputSchema: StockHistoryInputSchema,
      outputSchema: StockHistoryResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.stockHistory(input).then(answer(renderStockHistory), fail),
  );
  server.registerTool(
    ToolName.StockFundamentals,
    {
      title: "Stock Fundamentals",
      description:
        "A US-listed company's fundamentals from its annual and quarterly reports (10-K, 10-Q): per fiscal year revenue, gross profit, operating income, net income, diluted EPS, operating cash flow, capex, free cash flow and the year-end balance sheet; plus the latest balance sheet and shares outstanding. In USD.",
      inputSchema: StockFundamentalsInputSchema,
      outputSchema: StockFundamentalsResultSchema,
      annotations: READ_ONLY,
    },
    async (input) => api.stockFundamentals(input).then(answer(renderStockFundamentals), fail),
  );
}
