import { z } from "zod";
import { enumOf } from "../../enums.js";

/**
 * Every daily community-tier asset metric that carries data, by its Coin
 * Metrics name (checked live 2026-11-25, catalog-v2/asset-metrics and
 * timeseries). Left out on purpose: AssetCompletionTime and
 * AssetEODCompletionTime (metadata), ReferenceRate* (PriceUSD again), and
 * difficulty (DiffLast, DiffMean answer 403 "forbidden" on this tier for
 * every asset).
 */
const coinMetricsMetric = enumOf({
  PriceUsd: "PriceUSD",
  PriceBtc: "PriceBTC",
  MarketCapUsd: "CapMrktCurUSD",
  MarketCapEstimatedUsd: "CapMrktEstUSD",
  Mvrv: "CapMVRVCur",
  Supply: "SplyCur",
  SupplyExpected10y: "SplyExpFut10yr",
  ReportedSpotVolumeUsd: "volume_reported_spot_usd_1d",
  HashRate: "HashRate",
  Blocks: "BlkCnt",
  Issued: "IssTotNtv",
  IssuedUsd: "IssTotUSD",
  Fees: "FeeTotNtv",
  TxCount: "TxCnt",
  Transfers: "TxTfrCnt",
  ActiveAddresses: "AdrActCnt",
  AddressesWithBalance: "AdrBalCnt",
  ExchangeInflow: "FlowInExNtv",
  ExchangeInflowUsd: "FlowInExUSD",
  ExchangeOutflow: "FlowOutExNtv",
  ExchangeOutflowUsd: "FlowOutExUSD",
  SupplyOnExchanges: "SplyExNtv",
  SupplyOnExchangesUsd: "SplyExUSD",
  Roi30d: "ROI30d",
  Roi1y: "ROI1yr",
} as const);
export const CoinMetricsMetric = coinMetricsMetric.values;
export const CoinMetricsMetricSchema = coinMetricsMetric.schema;
export type CoinMetricsMetric = z.infer<typeof CoinMetricsMetricSchema>;

/** Every metric, in the order the request lists them. */
export const METRICS: readonly CoinMetricsMetric[] = CoinMetricsMetricSchema.options;

/**
 * Coin Metrics states every figure as a decimal string, often with more
 * digits than a double holds (BTC HashRate "978510879.725157058725939387528794019798").
 * The string is read as the nearest number, nothing rounded on our side;
 * a metric not computed (yet) for a day is absent or null.
 */
const Decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/, "not a decimal number")
  .transform(Number)
  .refine(Number.isFinite, "not a finite number")
  .nullish()
  .transform((value) => value ?? undefined);

/**
 * One asset on one day. Exchange metrics come with "<metric>-status"
 * ("flash": preliminary, seen live) and "-status-time" companions, which
 * are not figures and are dropped with any other unknown key.
 */
export const MetricRowSchema = z.object({
  asset: z.string().min(1),
  time: z.string().regex(/^\d{4}-\d{2}-\d{2}T/, "not an ISO time"),
  ...(Object.fromEntries(METRICS.map((metric) => [metric, Decimal])) as Record<CoinMetricsMetric, typeof Decimal>),
});
export type MetricRow = z.infer<typeof MetricRowSchema>;

/** One page of rows; `next_page_token` while more rows follow. */
export const MetricPageSchema = z.object({
  data: z.array(MetricRowSchema),
  next_page_token: z.string().min(1).optional(),
});
export type MetricPage = z.infer<typeof MetricPageSchema>;

/** Coin Metrics' own refusal, e.g. {"error":{"type":"forbidden","message":"Requested metric ..."}}. */
export const RefusalSchema = z.object({ error: z.object({ type: z.string(), message: z.string() }) });
export type Refusal = z.infer<typeof RefusalSchema>;

/** Either answer; the refusal is tried first so its words are never lost to a shape error. */
export const ResponseSchema = z.union([RefusalSchema, MetricPageSchema]);
