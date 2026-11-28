/**
 * Public contract for stock_quote, stock_history and stock_fundamentals.
 * No provider appears anywhere. Measured fields are optional (no source has
 * them all); new fields may be added later, but none is renamed, removed or
 * retyped. Prices are in the instrument's own currency (`currency`); the
 * fundamentals are in USD, as companies file them with the SEC.
 */

import { z } from "zod";
import { enumOf } from "./enums.js";
import { ResultMetaSchema } from "./schemas.js";

/** Most symbols one stock_quote call may ask for. */
export const MAX_QUOTE_SYMBOLS = 25;
/**
 * Most bars one stock_history call returns: a bar with every field is about
 * 115 characters, so 400 stay under the 50,000-character ceiling.
 */
export const MAX_HISTORY_BARS = 400;
/** Most fiscal years one stock_fundamentals call returns. */
export const MAX_FUNDAMENTAL_YEARS = 10;
export const DEFAULT_STOCK_MAX_AGE_SECONDS = { quote: 60, history: 3_600, fundamentals: 86_400 } as const;
/** Default stock_history window, in calendar days back from today. */
export const DEFAULT_HISTORY_DAYS = 30;

/** What kind of instrument a symbol names. */
const instrumentType = enumOf({
  Stock: "stock",
  Etf: "etf",
  Fund: "fund",
  Index: "index",
  Crypto: "crypto",
  Currency: "currency",
  Future: "future",
  Other: "other",
} as const);
export const InstrumentType = instrumentType.values;
export const InstrumentTypeSchema = instrumentType.schema;
export type InstrumentType = z.infer<typeof InstrumentTypeSchema>;

/** How much time one history bar covers. */
const barInterval = enumOf({ Day: "day", Week: "week", Month: "month" } as const);
export const BarInterval = barInterval.values;
export const BarIntervalSchema = barInterval.schema;
export type BarInterval = z.infer<typeof BarIntervalSchema>;

/**
 * Calendar days one call may span per interval, so the bars stay under
 * MAX_HISTORY_BARS: about 252 trading days a year, 52 weeks, 12 months.
 */
export const MAX_SPAN_DAYS: Readonly<Record<BarInterval, number>> = {
  [BarInterval.Day]: 550,
  [BarInterval.Week]: 2_750,
  [BarInterval.Month]: 30 * 366,
};

/**
 * What a crypto pair is quoted in (BTC-USD, ETH-EUR, ETH-BTC, SOL-USDT):
 * currencies and the coins others trade against. A share class is one letter
 * (BRK-B), so it never matches.
 */
const PAIR_QUOTES = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "HKD", "SGD", "KRW", "INR", "BRL", "MXN", "RUB", "TRY", "ZAR", "NZD", "SEK", "NOK", "DKK", "PLN", "USDT", "USDC", "BTC", "ETH"];
const CRYPTO_PAIR = new RegExp(`^[A-Z0-9]{2,10}-(${PAIR_QUOTES.join("|")})$`, "i");

/** A coin against a currency or another coin: crypto, which the stock tools refuse. */
export const isCryptoPair = (symbol: string) => CRYPTO_PAIR.test(symbol.trim());

/** Why a crypto symbol is refused, and where to ask instead. */
export function cryptoRefusal(symbol: string): string {
  const coin = isCryptoPair(symbol) ? ` with symbol ${symbol.trim().split("-")[0]!.toUpperCase()}` : "";
  return `${symbol} is crypto, which the stock tools do not quote: ask crypto_coin or crypto_market (REST /v1/crypto/coin, /v1/crypto/market)${coin}`;
}

/** Tickers as markets write them: AAPL, BRK-B, ^GSPC, SAP.DE, EURUSD=X. Crypto is refused (crypto_coin, crypto_market). */
const ticker = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9^][A-Za-z0-9.^=-]{0,19}$/, "a ticker like AAPL, BRK-B, ^GSPC or SAP.DE")
  .refine((s) => !isCryptoPair(s), { error: (issue) => cryptoRefusal(String(issue.input)) });
/** Tickers compare upper-case. */
export const upperTicker = (s: string) => s.trim().toUpperCase();
const eachOnce = (s: string[]) => new Set(s.map(upperTicker)).size === s.length;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a day, YYYY-MM-DD");
const isoTime = z.iso.datetime({ offset: true });
const price = z.number().finite().nonnegative();
const usd = z.number().finite().describe("USD");
const maxAge = (seconds: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(30 * 86_400)
    .default(seconds)
    .describe(`Oldest cached answer to accept, in seconds (default ${seconds}); 0 asks the sources again`);

// ---- stock_quote ----

export const StockQuoteInputSchema = z.object({
  symbols: z.array(ticker).min(1).max(MAX_QUOTE_SYMBOLS).refine(eachOnce, "each symbol once").describe("Tickers, e.g. [\"AAPL\", \"BRK-B\", \"^GSPC\"]"),
  max_age: maxAge(DEFAULT_STOCK_MAX_AGE_SECONDS.quote),
});

export const StockQuoteSchema = z.object({
  symbol: z.string().describe("As asked, upper-case"),
  name: z.string().optional(),
  instrument_type: InstrumentTypeSchema.optional(),
  exchange: z.string().optional().describe("Where it trades, e.g. NYSE, XETRA"),
  currency: z.string().optional().describe("Currency of every price, e.g. USD, EUR"),
  price: price.describe("The latest regular-session price"),
  previous_close: price.optional().describe("The last session's close before market_date"),
  change: z.number().finite().optional().describe("price - previous_close"),
  change_pct: z.number().finite().optional().describe("change as a percent of previous_close"),
  open: price.optional(),
  day_high: price.optional(),
  day_low: price.optional(),
  volume: z.number().nonnegative().optional().describe("Shares (units) traded in the session so far"),
  fifty_two_week_high: price.optional(),
  fifty_two_week_low: price.optional(),
  market_date: isoDay.describe("The session price belongs to, in the exchange's own time zone"),
  as_of: isoTime.optional().describe("When price was set, where the source states the time"),
});

export const StockQuoteResultSchema = z.object({
  quotes: z.array(StockQuoteSchema).describe("In the order asked"),
  missing: z.array(z.string()).describe("Asked-for symbols no source knows"),
  meta: ResultMetaSchema,
});

// ---- stock_history ----

const DAY_MS = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const daysBefore = (day: string, n: number) => new Date(Date.parse(day) - n * DAY_MS).toISOString().slice(0, 10);

export const StockHistoryInputSchema = z
  .object({
    symbol: ticker.describe("One ticker, e.g. AAPL"),
    from: isoDay.optional().describe(`First day, YYYY-MM-DD (default ${DEFAULT_HISTORY_DAYS} days before to)`),
    to: isoDay.optional().describe("Last day, YYYY-MM-DD (default today)"),
    interval: BarIntervalSchema.default(BarInterval.Day).describe("day, week (Monday to Friday) or month bars"),
    max_age: maxAge(DEFAULT_STOCK_MAX_AGE_SECONDS.history),
  })
  .superRefine((q, ctx) => {
    const to = q.to ?? today();
    const from = q.from ?? daysBefore(to, DEFAULT_HISTORY_DAYS);
    if (to > today()) return void ctx.addIssue({ code: "custom", message: "to must not be after today (UTC)", path: ["to"] });
    if (from > to) return void ctx.addIssue({ code: "custom", message: "from must not be after to", path: ["from"] });
    const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
    const max = MAX_SPAN_DAYS[q.interval];
    if (span > max) {
      const wider = q.interval === BarInterval.Day ? "interval week or month" : q.interval === BarInterval.Week ? "interval month" : "a shorter range";
      ctx.addIssue({ code: "custom", message: `at most ${max} days with ${q.interval} bars (up to ${MAX_HISTORY_BARS} bars): use ${wider}, or split the dates`, path: ["from"] });
    }
  });

/** The query's window, both days included. */
export function historyWindow(q: Pick<StockHistoryQuery, "from" | "to">, now = Date.now()): { from: string; to: string } {
  const to = q.to ?? new Date(now).toISOString().slice(0, 10);
  return { from: q.from ?? daysBefore(to, DEFAULT_HISTORY_DAYS), to };
}

export const StockBarSchema = z.object({
  date: isoDay.describe("The bar's first trading day, in the exchange's time zone"),
  open: price.optional(),
  high: price.optional(),
  low: price.optional(),
  close: price,
  adj_close: price.optional().describe("close adjusted for later splits and dividends, for returns over time"),
  volume: z.number().nonnegative().optional(),
});

export const StockHistoryResultSchema = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  currency: z.string().optional(),
  interval: BarIntervalSchema,
  from: isoDay,
  to: isoDay,
  bars: z.array(StockBarSchema).describe("Oldest first; days the market was closed have no bar"),
  dividends: z.array(z.object({ date: isoDay, amount: price })).optional().describe("Cash dividends per share, by ex-dividend date, where the source states them"),
  splits: z.array(z.object({ date: isoDay, ratio: z.string().describe("New shares for old, e.g. 4:1") })).optional(),
  meta: ResultMetaSchema,
});

// ---- stock_fundamentals ----

export const StockFundamentalsInputSchema = z.object({
  symbol: ticker.describe("A US-listed company's ticker, e.g. AAPL"),
  years: z.number().int().min(1).max(MAX_FUNDAMENTAL_YEARS).default(5).describe("Fiscal years to return, newest first"),
  max_age: maxAge(DEFAULT_STOCK_MAX_AGE_SECONDS.fundamentals),
});

const BALANCE = {
  assets_usd: usd.optional(),
  liabilities_usd: usd.optional(),
  equity_usd: usd.optional().describe("Stockholders' equity"),
  cash_usd: usd.optional().describe("Cash and cash equivalents"),
  long_term_debt_usd: usd.optional(),
};

export const FiscalYearSchema = z.object({
  period_end: isoDay.describe("Last day of the fiscal year"),
  fiscal_year: z.number().int().describe("The calendar year period_end falls in"),
  revenue_usd: usd.optional(),
  gross_profit_usd: usd.optional(),
  operating_income_usd: usd.optional(),
  net_income_usd: usd.optional().describe("Attributable to the company's shareholders"),
  eps_diluted_usd: usd.optional().describe("Diluted earnings per share"),
  operating_cash_flow_usd: usd.optional(),
  capex_usd: usd.optional().describe("Paid for property, plant and equipment"),
  free_cash_flow_usd: usd.optional().describe("operating_cash_flow_usd - capex_usd"),
  ...BALANCE,
  filed: isoDay.optional().describe("When the annual report carrying these figures was filed"),
});

export const StockFundamentalsResultSchema = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  shares_outstanding: z.number().nonnegative().optional().describe("Common shares, as of shares_outstanding_as_of"),
  shares_outstanding_as_of: isoDay.optional(),
  latest_balance_sheet: z
    .object({ as_of: isoDay, ...BALANCE })
    .optional()
    .describe("The most recent balance sheet filed (annual or quarterly)"),
  years: z.array(FiscalYearSchema).describe("Newest first, from annual reports; a figure the company did not report is absent"),
  meta: ResultMetaSchema,
});

export type StockQuoteInput = z.input<typeof StockQuoteInputSchema>;
export type StockQuoteQuery = z.infer<typeof StockQuoteInputSchema>;
export type StockQuote = z.infer<typeof StockQuoteSchema>;
export type StockQuoteResult = z.infer<typeof StockQuoteResultSchema>;
export type StockHistoryInput = z.input<typeof StockHistoryInputSchema>;
export type StockHistoryQuery = z.infer<typeof StockHistoryInputSchema>;
export type StockBar = z.infer<typeof StockBarSchema>;
export type StockHistoryResult = z.infer<typeof StockHistoryResultSchema>;
export type StockFundamentalsInput = z.input<typeof StockFundamentalsInputSchema>;
export type StockFundamentalsQuery = z.infer<typeof StockFundamentalsInputSchema>;
export type FiscalYear = z.infer<typeof FiscalYearSchema>;
export type StockFundamentalsResult = z.infer<typeof StockFundamentalsResultSchema>;
