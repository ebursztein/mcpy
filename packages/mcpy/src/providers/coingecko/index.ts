/**
 * CoinGecko (demo API): live markets, whole-market totals and up to a year
 * of daily history. The demo key allows 30 calls a minute and about 10,000
 * a month, and it is shared, so every operation makes as few calls as it
 * can: a snapshot is one markets call per 50 symbols (plus /global when
 * totals are asked), a history one markets call per 50 symbols to resolve
 * ids plus one chart call per known coin.
 */

import { z } from "zod";
import { ErrorCode, UserAgentProfile } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import { isoFromUnix, type CryptoCapabilities, type CryptoProvider, type FoundCoinDay, type FoundLiveCoin, type FoundTotals } from "../crypto-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { ChartResponseSchema, ErrorBodySchema, GlobalResponseSchema, MarketRowSchema, MarketsResponseSchema, type ChartResponse, type GlobalResponse, type MarketRow } from "./schemas.js";

export interface CoinGeckoOptions {
  /**
   * Demo key from coingecko.com/en/developers/dashboard. Without it calls
   * still work, but share the keyless limit with every client on the same
   * IP (seen live: 429 after five calls from one address).
   */
  apiKey?: string;
  costPerCall?: number;
}

export const COINGECKO_API = "https://api.coingecko.com/api/v3";
/** Verified live: 51 symbols answer 400 "allows a maximum of 50 symbols per request". */
export const MAX_SYMBOLS_PER_CALL = 50;
/** Most rows one markets page returns. */
export const MAX_PER_PAGE = 250;
/** Verified live: the demo plan answers 401 (error_code 10012) to days=366. */
export const MAX_HISTORY_DAYS = 365;
/** Chart calls in flight at once, kept low for the shared 30-a-minute key. */
const CHART_CONCURRENCY = 3;
const DAY_MS = 86_400_000;

export const COINGECKO_CAPABILITIES: CryptoCapabilities = { totals: true, live: true, history: true };

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Lower-case, each once: CoinGecko matches symbols case-insensitively. */
const symbolsOf = (symbols: readonly string[]) => [...new Set(symbols.map((s) => s.trim().toLowerCase()).filter(Boolean))];

/**
 * Markets URLs: one per 50 symbols, each answering the largest coin for each
 * symbol (`include_tokens=top`, verified live: "eth" gives Ethereum, not the
 * 13 bridged ETH tokens `all` lists), or the largest coins by market cap.
 */
export function marketsUrls(req: { symbols?: readonly string[]; limit: number }): string[] {
  const base = `${COINGECKO_API}/coins/markets?vs_currency=usd&price_change_percentage=24h,7d`;
  if (req.symbols === undefined) return [`${base}&order=market_cap_desc&per_page=${Math.min(Math.max(req.limit, 1), MAX_PER_PAGE)}&page=1`];
  const symbols = symbolsOf(req.symbols);
  const urls: string[] = [];
  for (let i = 0; i < symbols.length; i += MAX_SYMBOLS_PER_CALL) {
    const chunk = symbols.slice(i, i + MAX_SYMBOLS_PER_CALL).map(encodeURIComponent).join(",");
    urls.push(`${base}&symbols=${chunk}&include_tokens=top`);
  }
  return urls;
}

export const GLOBAL_URL = `${COINGECKO_API}/global`;

/**
 * Days of chart that cover `from` through yesterday. `days=N` answers the
 * midnights from today-(N-1) to today (verified live), and the close of day
 * D is the midnight that starts D+1 (see dailyCloses), so from's close needs
 * N = today - from; one more day absorbs the edge, capped at the plan's 365.
 */
export function chartDays(from: string, today: string): number {
  const span = Math.round((Date.parse(today) - Date.parse(from)) / DAY_MS) + 1;
  return Math.min(Math.max(span, 1), MAX_HISTORY_DAYS);
}

export const chartUrl = (id: string, days: number) =>
  `${COINGECKO_API}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;

/** Request headers; the key only when set. CoinGecko answers 403 to a request without a descriptive User-Agent. */
export function coinGeckoHeaders(call: ProviderCall, apiKey?: string): Record<string, string> {
  return {
    accept: "application/json",
    "user-agent": call.userAgent(UserAgentProfile.Default),
    ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
  };
}

/** A figure CoinGecko reports, or undefined for null and 0 (its "no data"). */
const positive = (n: number | null | undefined) => (n !== null && n !== undefined && n > 0 ? n : undefined);

/** A signed percent: 0 is a real figure (a pegged token), only null is none. */
const signed = (n: number | null | undefined) => (n === null || n === undefined ? undefined : n);

/** One markets row as a live coin (the schema already dropped rows without a time). */
export function toLiveCoin(row: MarketRow): FoundLiveCoin {
  const low = positive(row.low_24h);
  const high = positive(row.high_24h);
  return {
    symbol: row.symbol.trim().toUpperCase(),
    name: row.name?.trim() || undefined,
    asOf: new Date(row.last_updated).toISOString(),
    priceUsd: positive(row.current_price),
    priceChange24hPct: signed(row.price_change_percentage_24h_in_currency) ?? signed(row.price_change_percentage_24h),
    priceChange7dPct: signed(row.price_change_percentage_7d_in_currency),
    // A range whose ends cross is not a range; neither end is trusted then.
    high24hUsd: low !== undefined && high !== undefined && high < low ? undefined : high,
    low24hUsd: low !== undefined && high !== undefined && high < low ? undefined : low,
    allTimeHighUsd: positive(row.ath),
    allTimeHighDate: row.ath_date ? new Date(row.ath_date).toISOString().slice(0, 10) : undefined,
    marketCapUsd: positive(row.market_cap),
    marketCapRank: row.market_cap_rank ?? undefined,
    fullyDilutedValueUsd: positive(row.fully_diluted_valuation),
    volume24hUsd: positive(row.total_volume),
    supply: positive(row.circulating_supply),
    totalSupply: positive(row.total_supply),
    maxSupply: positive(row.max_supply),
  };
}

/** Valid rows of a markets answer; malformed ones are skipped. */
export function marketRows(rows: readonly unknown[]): MarketRow[] {
  return rows.flatMap((raw) => {
    const row = MarketRowSchema.safeParse(raw);
    return row.success ? [row.data] : [];
  });
}

/** Whole-market totals, or undefined without a usable total market cap. */
export function toTotals(body: GlobalResponse): FoundTotals | undefined {
  const { data } = body;
  const totalMarketCapUsd = positive(data.total_market_cap.usd);
  if (totalMarketCapUsd === undefined) return undefined;
  const dominance = data.market_cap_percentage?.btc;
  return {
    asOf: isoFromUnix(data.updated_at),
    totalMarketCapUsd,
    totalVolume24hUsd: positive(data.total_volume?.usd),
    btcDominancePct: dominance !== undefined && dominance >= 0 && dominance <= 100 ? dominance : undefined,
    totalMarketCapChange24hPct: signed(data.market_cap_change_percentage_24h_usd),
    activeCoins: data.active_cryptocurrencies ?? undefined,
    markets: data.markets ?? undefined,
  };
}

/**
 * Daily figures by the UTC day they close. With interval=daily every point
 * but the last sits exactly on 00:00 UTC, and the last is "now". Verified
 * live 2026-11-25 for RVN: the daily point stamped 2026-11-24T00:00Z equals
 * the hourly series' 2026-11-24T00:00Z point exactly (price, market cap and
 * the trailing 24 h volume alike), so it is the market at the end of
 * 2026-11-23. Rule: a point at 00:00 UTC of day D is day D-1's close, its
 * market cap and its 24 h volume; points off midnight (the live one) are
 * dropped. A year of daily points (days=365) had none off midnight.
 */
export function dailyCloses(chart: ChartResponse, symbol: string, from: string, to: string, name?: string): FoundCoinDay[] {
  const days = new Map<string, FoundCoinDay>();
  const put = (points: ChartResponse["prices"], field: "priceUsd" | "marketCapUsd" | "volumeUsd") => {
    for (const [ms, value] of points) {
      const figure = positive(value);
      if (ms % DAY_MS !== 0 || figure === undefined) continue;
      const date = isoDay(ms - DAY_MS);
      if (date < from || date > to) continue;
      days.set(date, { ...(days.get(date) ?? { symbol, ...(name ? { name } : {}), date }), [field]: figure });
    }
  };
  put(chart.prices, "priceUsd");
  put(chart.market_caps, "marketCapUsd");
  put(chart.total_volumes, "volumeUsd");
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const STATUS_CODE: Readonly<Record<number, ErrorCode>> = {
  401: ErrorCode.Unauthorized,
  403: ErrorCode.Forbidden,
  429: ErrorCode.RateLimited,
};

/** GET a CoinGecko endpoint. Any HTTP error is a ProviderFailure carrying the status (429 included). */
async function getJson<S extends z.ZodType>(url: string, schema: S, call: ProviderCall, apiKey?: string): Promise<z.infer<S>> {
  const { response, data } = await call.http.json({ url, headers: coinGeckoHeaders(call, apiKey) }, z.unknown(), call.context);
  if (response.status >= 400) {
    const body = ErrorBodySchema.safeParse(data);
    const err = body.success ? body.data.error : undefined;
    const detail = typeof err === "string" ? err : (err?.status?.error_message ?? (body.success ? body.data.status?.error_message : undefined));
    const message = `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`;
    throw new ProviderFailure(STATUS_CODE[response.status] ?? ErrorCode.UpstreamFailed, message, response.status);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ProviderFailure(ErrorCode.BadResponse, `unexpected CoinGecko response from ${new URL(url).pathname}`, response.status);
  return parsed.data;
}

/** Markets rows for the request, the largest coin kept when a symbol shows up twice. */
async function fetchMarkets(req: { symbols?: readonly string[]; limit: number }, call: ProviderCall, apiKey?: string): Promise<MarketRow[]> {
  const pages = await Promise.all(marketsUrls(req).map((url) => getJson(url, MarketsResponseSchema, call, apiKey)));
  const rows = marketRows(pages.flat());
  if (req.symbols === undefined) return rows.slice(0, req.limit);
  const wanted = new Set(symbolsOf(req.symbols));
  const bySymbol = new Map<string, MarketRow>();
  for (const row of rows) {
    const key = row.symbol.trim().toLowerCase();
    const seen = bySymbol.get(key);
    if (wanted.has(key) && (!seen || (row.market_cap ?? 0) > (seen.market_cap ?? 0))) bySymbol.set(key, row);
  }
  return [...bySymbol.values()];
}

/** Runs `task` over `items`, at most `limit` at once, results in order. */
async function pooled<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) out.push(...(await Promise.all(items.slice(i, i + limit).map(task))));
  return out;
}

/** CoinGecko: prices, market caps, volumes and supply for every listed coin, and whole-market totals. */
export function coinGecko(options: CoinGeckoOptions = {}): CryptoProvider {
  const { apiKey } = options;
  return {
    id: ProviderId.CoinGecko,
    costPerCall: options.costPerCall ?? 0,
    capabilities: COINGECKO_CAPABILITIES,
    async snapshot(req, call) {
      if (req.symbols !== undefined && symbolsOf(req.symbols).length === 0) return { coins: [] };
      const [rows, global] = await Promise.all([
        fetchMarkets(req, call, apiKey),
        req.totals ? getJson(GLOBAL_URL, GlobalResponseSchema, call, apiKey) : Promise.resolve(undefined),
      ]);
      const coins = rows.map(toLiveCoin);
      const totals = global ? toTotals(global) : undefined;
      return totals ? { totals, coins } : { coins };
    },
    async history(req, call) {
      if (!DAY.test(req.from) || !DAY.test(req.to)) throw new ProviderFailure(ErrorCode.InvalidInput, "from and to must be YYYY-MM-DD");
      const today = isoDay(Date.now());
      const yesterday = isoDay(Date.parse(today) - DAY_MS);
      const to = req.to < today ? req.to : yesterday;
      if (req.from > to || symbolsOf(req.symbols).length === 0) return [];
      const coins = await fetchMarkets({ symbols: req.symbols, limit: MAX_PER_PAGE }, call, apiKey);
      const days = chartDays(req.from, today);
      const perCoin = await pooled(coins, CHART_CONCURRENCY, async (row) => {
        const chart = await getJson(chartUrl(row.id, days), ChartResponseSchema, call, apiKey);
        return dailyCloses(chart, row.symbol.trim().toUpperCase(), req.from, to, row.name?.trim() || undefined);
      });
      return perCoin.flat();
    },
  };
}
