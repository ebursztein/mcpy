import { ErrorCode } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import type { CryptoCapabilities, CryptoProvider, FoundCoinDay, HistoryRequest } from "../crypto-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { CoinMetricsMetric, METRICS, ResponseSchema, type MetricPage, type MetricRow } from "./schemas.js";

export interface CoinMetricsOptions {
  /** The community API is free and needs no key. */
  costPerCall?: number;
}

const API = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics";
/**
 * Rows a page holds. Coin Metrics allows up to 10,000, but with every metric
 * a row runs to 1.4 KB (BTC with its exchange metrics, live 2026-11-25), so
 * 10,000 rows could pass the engine's 5 MB response limit; 2,500 stay under
 * 3.5 MB. Ten assets over 60 days are 600 rows, one page of about 376 KB.
 */
export const PAGE_SIZE = 2_500;
/** Pages followed before giving up: 25,000 asset-days, ten coins over almost seven years. */
export const MAX_PAGES = 10;

export const COIN_METRICS_CAPABILITIES: CryptoCapabilities = { totals: false, live: false, history: true };

export interface CoinMetricsAsset {
  /** Coin Metrics' asset id. */
  asset: string;
  /** H/s in one unit of the asset's HashRate metric; unset: its HashRate is never reported. */
  hashrateHs?: number;
}

/**
 * Coins with a known asset id and HashRate unit. Units carried over from the
 * owner's deepmine project (config/coins.json, `sources.coinmetrics`, which
 * reads these days in production): BTC, BCH, LTC, DOGE and ETC state TH/s
 * (BTC 2026-11-20: 978,510,879 = 979 EH/s), ZEC and DASH GH/s (ZEC's
 * Equihash: GSol/s, 36 on 2026-11-20), XMR H/s. KAS and RVN have no HashRate
 * on the community tier (checked live 2026-11-25), nor ETH, SOL and XRP a
 * unit, so none is claimed for them.
 */
export const COIN_METRICS_ASSETS: Readonly<Record<string, CoinMetricsAsset>> = {
  BTC: { asset: "btc", hashrateHs: 1e12 },
  BCH: { asset: "bch", hashrateHs: 1e12 },
  LTC: { asset: "ltc", hashrateHs: 1e12 },
  DOGE: { asset: "doge", hashrateHs: 1e12 },
  ETC: { asset: "etc", hashrateHs: 1e12 },
  ZEC: { asset: "zec", hashrateHs: 1e9 },
  DASH: { asset: "dash", hashrateHs: 1e9 },
  XMR: { asset: "xmr", hashrateHs: 1 },
  KAS: { asset: "kas" },
  RVN: { asset: "rvn" },
  ETH: { asset: "eth" },
  SOL: { asset: "sol" },
  XRP: { asset: "xrp" },
};

/** A ticker that can go into the comma-separated `assets` list as is. */
const TICKER = /^[A-Z0-9][A-Z0-9_-]*$/;

/**
 * The asset for a ticker: from the table, else the lower-cased ticker
 * (Coin Metrics' ids are mostly that), without a HashRate unit since none
 * is known. Undefined for a ticker that cannot be an asset id.
 */
export function assetFor(symbol: string): CoinMetricsAsset | undefined {
  const ticker = symbol.trim().toUpperCase();
  if (!TICKER.test(ticker)) return undefined;
  return COIN_METRICS_ASSETS[ticker] ?? { asset: ticker.toLowerCase() };
}

/** Requested tickers by asset id (first ticker wins when two name one asset). */
export function assetsFor(symbols: readonly string[]): Map<string, { symbol: string } & CoinMetricsAsset> {
  const byAsset = new Map<string, { symbol: string } & CoinMetricsAsset>();
  for (const symbol of symbols) {
    const found = assetFor(symbol);
    if (found && !byAsset.has(found.asset)) byAsset.set(found.asset, { symbol: symbol.trim().toUpperCase(), ...found });
  }
  return byAsset;
}

/**
 * One request for every asset and metric over the days, both ends included.
 * `ignore_unsupported_errors`: without it, an asset Coin Metrics does not
 * know, or one with none of the metrics (rvn asked only HashRate), fails the
 * whole request with 400 bad_parameter; with it those are left out (all
 * checked live 2026-11-25). An asset with only some of the metrics (rvn:
 * price and volume) is answered either way, the others just absent.
 * `ignore_forbidden_errors`: without it, one metric the community tier
 * withholds from one asset fails the whole request with 403 forbidden (sol:
 * CapMrktCurUSD); with it that asset's other metrics still come back.
 * `paging_from=start`: pages run oldest first (the default runs from the end).
 */
export function coinMetricsUrl(assets: readonly string[], from: string, to: string, pageToken?: string, pageSize = PAGE_SIZE): string {
  const params = [
    `assets=${assets.map(encodeURIComponent).join(",")}`,
    `metrics=${METRICS.join(",")}`,
    "frequency=1d",
    `start_time=${encodeURIComponent(from)}`,
    `end_time=${encodeURIComponent(to)}`,
    `page_size=${pageSize}`,
    "paging_from=start",
    "ignore_unsupported_errors=true",
    "ignore_forbidden_errors=true",
  ];
  if (pageToken) params.push(`next_page_token=${encodeURIComponent(pageToken)}`);
  return `${API}?${params.join("&")}`;
}

/** Metrics that map one to one onto a day's field, as Coin Metrics states them. */
const FIELD: Partial<Record<CoinMetricsMetric, keyof FoundCoinDay>> = {
  [CoinMetricsMetric.PriceUsd]: "priceUsd",
  [CoinMetricsMetric.PriceBtc]: "priceBtc",
  [CoinMetricsMetric.MarketCapUsd]: "marketCapUsd",
  [CoinMetricsMetric.MarketCapEstimatedUsd]: "marketCapEstimatedUsd",
  [CoinMetricsMetric.Mvrv]: "mvrv",
  [CoinMetricsMetric.Supply]: "supply",
  [CoinMetricsMetric.SupplyExpected10y]: "supplyExpected10yCoins",
  [CoinMetricsMetric.ReportedSpotVolumeUsd]: "reportedSpotVolumeUsd",
  [CoinMetricsMetric.Blocks]: "blocks",
  [CoinMetricsMetric.TxCount]: "txCount",
  [CoinMetricsMetric.Transfers]: "transfers",
  [CoinMetricsMetric.ActiveAddresses]: "activeAddresses",
  [CoinMetricsMetric.AddressesWithBalance]: "addressesWithBalance",
  [CoinMetricsMetric.ExchangeInflow]: "exchangeInflowCoins",
  [CoinMetricsMetric.ExchangeInflowUsd]: "exchangeInflowUsd",
  [CoinMetricsMetric.ExchangeOutflow]: "exchangeOutflowCoins",
  [CoinMetricsMetric.ExchangeOutflowUsd]: "exchangeOutflowUsd",
  [CoinMetricsMetric.SupplyOnExchanges]: "supplyOnExchangesCoins",
  [CoinMetricsMetric.SupplyOnExchangesUsd]: "supplyOnExchangesUsd",
  // Already in percent: BTC's ROI30d on 2026-11-23 was -24.097, its price
  // 80,699.31 thirty days before and 61,253.22 that day (-24.1%), live.
  [CoinMetricsMetric.Roi30d]: "roi30dPct",
  [CoinMetricsMetric.Roi1y]: "roi1yPct",
};

/**
 * Fees Coin Metrics states negative are other payments netted out (DASH:
 * masternode and treasury payments; deepmine, production 2026-11-02), never
 * the fees a block paid, so they are left out; so is a negative issuance.
 */
const nonNegative = (value: number | undefined) => (value === undefined || value < 0 ? undefined : value);

/** A row as the day it describes, or undefined when it says nothing usable. */
export function toCoinDay(row: MetricRow, coin: { symbol: string; hashrateHs?: number }): FoundCoinDay | undefined {
  const figures: Partial<Record<keyof FoundCoinDay, number | undefined>> = {};
  for (const [metric, field] of Object.entries(FIELD) as [CoinMetricsMetric, keyof FoundCoinDay][]) figures[field] = row[metric];
  const hashrate = row[CoinMetricsMetric.HashRate];
  // Coin Metrics derives HashRate from the day's own blocks and difficulty.
  figures.networkHashrateHs = hashrate !== undefined && coin.hashrateHs !== undefined ? hashrate * coin.hashrateHs : undefined;
  figures.issuedCoins = nonNegative(row[CoinMetricsMetric.Issued]);
  figures.issuedUsd = nonNegative(row[CoinMetricsMetric.IssuedUsd]);
  figures.feesCoins = nonNegative(row[CoinMetricsMetric.Fees]);
  const known = Object.fromEntries(Object.entries(figures).filter(([, v]) => v !== undefined));
  if (Object.keys(known).length === 0) return undefined;
  return { symbol: coin.symbol, date: row.time.slice(0, 10), ...known };
}

/** The days on one page for the requested assets, inside from..to; others are ignored. */
export function parsePage(page: MetricPage, assets: ReadonlyMap<string, { symbol: string; hashrateHs?: number }>, from: string, to: string): FoundCoinDay[] {
  return page.data.flatMap((row) => {
    const coin = assets.get(row.asset);
    const date = row.time.slice(0, 10);
    if (!coin || date < from || date > to) return [];
    const day = toCoinDay(row, coin);
    return day ? [day] : [];
  });
}

async function fetchPage(url: string, call: ProviderCall): Promise<MetricPage> {
  const { response, data } = await call.http.json({ url }, ResponseSchema, call.context);
  if ("error" in data) {
    throw new ProviderFailure(ErrorCode.UpstreamFailed, `${data.error.type}: ${data.error.message}`, response.status);
  }
  if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
  return data;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Coin Metrics community API: daily market and network figures for mined coins, free. */
export function coinMetrics(options: CoinMetricsOptions = {}): CryptoProvider {
  return {
    id: ProviderId.CoinMetrics,
    costPerCall: options.costPerCall ?? 0,
    capabilities: COIN_METRICS_CAPABILITIES,
    async history(req: HistoryRequest, call: ProviderCall) {
      if (!DAY.test(req.from) || !DAY.test(req.to)) throw new ProviderFailure(ErrorCode.InvalidInput, "from and to must be YYYY-MM-DD");
      const assets = assetsFor(req.symbols);
      if (assets.size === 0 || req.from > req.to) return [];
      const ids = [...assets.keys()];
      const days: FoundCoinDay[] = [];
      let token: string | undefined;
      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const page = await fetchPage(coinMetricsUrl(ids, req.from, req.to, token), call);
        days.push(...parsePage(page, assets, req.from, req.to));
        token = page.next_page_token;
        if (!token) return days;
      }
      throw new ProviderFailure(ErrorCode.TooLarge, `more than ${MAX_PAGES} pages of rows; narrow the window`);
    },
  };
}
