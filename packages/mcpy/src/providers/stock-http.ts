/** The JSON GET every stock source makes: status mapped to a failure, body checked with zod. */

import { z } from "zod";
import { ErrorCode } from "../enums.js";
import { ProviderFailure } from "../errors.js";
import type { ProviderCall } from "./types.js";

const STATUS_CODE: Readonly<Record<number, ErrorCode>> = {
  401: ErrorCode.Unauthorized,
  403: ErrorCode.Forbidden,
  429: ErrorCode.RateLimited,
};

export interface StockGet {
  url: string;
  headers: Record<string, string>;
  /** Statuses that mean "no such symbol" rather than a failure (Yahoo: 404). */
  notFound?: readonly number[];
  /** Larger responses than the engine's cap need it said (a decade of daily bars). */
  maxBytes?: number;
}

/**
 * GET `req.url` and parse it with `schema`; undefined when the status says the
 * symbol is unknown. Any other HTTP error is a ProviderFailure carrying the
 * status (429 as rate_limited), and a body of the wrong shape is bad_response.
 */
export async function getStockJson<S extends z.ZodType>(req: StockGet, schema: S, call: ProviderCall, source: string): Promise<z.infer<S> | undefined> {
  const context = req.maxBytes && req.maxBytes > call.context.maxBytes ? { ...call.context, maxBytes: req.maxBytes } : call.context;
  const { response, data } = await call.http.json({ url: req.url, headers: req.headers }, z.unknown(), context).catch((err: unknown) => {
    if (!(err instanceof ProviderFailure) || err.status === undefined) throw err;
    // A non-JSON body on a not-found status is still "no such symbol"; on an error status
    // ("Too Many Requests" as text) it is that status's failure, not a generic one.
    if (req.notFound?.includes(err.status)) return { response: undefined, data: undefined };
    const code = STATUS_CODE[err.status];
    throw code ? new ProviderFailure(code, `HTTP ${err.status} from ${source}`, err.status) : err;
  });
  if (!response || req.notFound?.includes(response.status)) return undefined;
  if (response.status >= 400) throw new ProviderFailure(STATUS_CODE[response.status] ?? ErrorCode.UpstreamFailed, `HTTP ${response.status} from ${source}`, response.status);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    throw new ProviderFailure(ErrorCode.BadResponse, `unexpected ${source} response: ${issues.join("; ")}`, response.status);
  }
  return parsed.data;
}

/** Runs `task` over `items`, at most `limit` at once, results in order. */
export async function pooled<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) out.push(...(await Promise.all(items.slice(i, i + limit).map(task))));
  return out;
}

/** A positive finite number, or undefined: sources send 0, null or NaN for "no data". */
export const positive = (n: number | null | undefined): number | undefined => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);
