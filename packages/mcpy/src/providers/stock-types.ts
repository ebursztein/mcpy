/**
 * Contract for stock data sources. The engine asks them in configured order
 * and a later source only answers what earlier ones could not; callers never
 * learn which source said what. A source reports figures as it states them
 * and leaves the rest undefined; a symbol it does not know is left out (or
 * undefined), never an error, so the next source gets its turn.
 */

import type { InstrumentType } from "../schemas-stocks.js";
import type { ProviderCall } from "./types.js";

/** One symbol's latest regular-session quote. */
export interface FoundQuote {
  /** As asked (upper-case), whatever the source calls it. */
  symbol: string;
  name?: string;
  instrumentType?: InstrumentType;
  exchange?: string;
  currency?: string;
  price: number;
  previousClose?: number;
  open?: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  /** YYYY-MM-DD, the session's day in the exchange's time zone. */
  marketDate: string;
  /** ISO time the price was set, when the source states it. */
  asOf?: string;
}

/** One trading day. */
export interface FoundBar {
  /** YYYY-MM-DD in the exchange's time zone. */
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  adjClose?: number;
  volume?: number;
}

/** Daily bars from `from` to `to` (both included, exchange days). */
export interface StockHistoryRequest {
  symbol: string;
  from: string;
  to: string;
}

export interface FoundHistory {
  name?: string;
  currency?: string;
  /** Oldest first. */
  bars: FoundBar[];
  dividends?: { date: string; amount: number }[];
  splits?: { date: string; ratio: string }[];
}

/** One filed figure: its value and the period it covers. */
export interface FiledFact {
  value: number;
  /** YYYY-MM-DD: the period's last day, or the balance-sheet date. */
  end: string;
  /** YYYY-MM-DD: the period's first day; absent for balance-sheet figures. */
  start?: string;
  /** YYYY-MM-DD it was filed. */
  filed: string;
  /** Filed in an annual report (10-K), not a quarterly one. */
  annual: boolean;
}

/** What a company filed, measure by measure (FundamentalMeasure keys). */
export interface FoundFundamentals {
  name?: string;
  facts: Partial<Record<FundamentalMeasure, FiledFact[]>>;
}

/** The measures a fundamentals source reports. */
export type FundamentalMeasure =
  | "revenue"
  | "grossProfit"
  | "operatingIncome"
  | "netIncome"
  | "epsDiluted"
  | "operatingCashFlow"
  | "capex"
  | "assets"
  | "liabilities"
  | "equity"
  | "cash"
  | "longTermDebt"
  | "sharesOutstanding";

/** What a source can answer; requests go only to sources that can. */
export interface StockCapabilities {
  quotes: boolean;
  history: boolean;
  fundamentals: boolean;
}

export interface StockProvider {
  readonly id: string;
  readonly costPerCall: number;
  readonly capabilities: StockCapabilities;
  readonly circuitBreaker?: boolean;
  readonly attemptTimeoutMs?: number;
  /** With `quotes`: the symbols it knows, any order. */
  quotes?(symbols: string[], call: ProviderCall): Promise<FoundQuote[]>;
  /** With `history`: undefined for a symbol it does not know. */
  history?(req: StockHistoryRequest, call: ProviderCall): Promise<FoundHistory | undefined>;
  /**
   * With `fundamentals`, for sources that name companies by an id of their own:
   * every symbol they know and its id, in one download. The service keeps it a
   * day under the source's id and hands `fundamentals` the symbol's id.
   */
  directory?(call: ProviderCall): Promise<Record<string, string>>;
  /** With `fundamentals`: undefined for a company it does not know. */
  fundamentals?(symbol: string, id: string | undefined, call: ProviderCall): Promise<FoundFundamentals | undefined>;
}

/** "2026-11-27" for a Unix time, in a zone `gmtOffsetSeconds` from UTC. */
export const localDay = (unixSeconds: number, gmtOffsetSeconds = 0) => new Date((unixSeconds + gmtOffsetSeconds) * 1000).toISOString().slice(0, 10);

/** A price to 4 decimals: sources send float noise (354.3399963378906). */
export const roundPrice = (n: number) => Math.round(n * 10_000) / 10_000;
