/**
 * Records every mcpy call a client makes: wraps the SDK so each call yields
 * log rows from its input and its result (or error). The cost is what the
 * call's paid attempts counted against the cap, failed calls included, read
 * through a spend limit that wraps the client's own; the backend that served
 * it comes from the SDK's onServed hook. Rows are handed to
 * `write` after the call; recording never changes or delays the answer.
 */

import { CacheStatus, CacheStatusSchema, ErrorCode, McpyError, Operation, runFetchBatch, SearchTypeSchema, type CallContext, type Mcpy, type McpyApi, type SpendLimit } from "mcpy";
import { CallStatus, CallStatusSchema, type CallStatus as Status, MAX_ARGS_CHARS, MAX_QUERY_CHARS, UNLOGGED_ARGS, type CallRow } from "./schema.js";

type Input = Record<string, unknown>;
type Meta = { cache?: string; attempts?: number; cost_usd?: number };
type Report = { marketplace: string; status: string; results: number; cost_usd?: number; search_url: string; failure?: string; error?: string };

const round = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;
const text = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : undefined);

function hostOf(url: unknown): string | undefined {
  try {
    return typeof url === "string" ? new URL(url).host.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** The inputs worth keeping, minus what is logged in its own column and what is never logged. */
function argsOf(input: Input): Record<string, unknown> {
  const args = Object.fromEntries(Object.entries(input).filter(([k]) => k !== "url" && k !== "query" && !UNLOGGED_ARGS.includes(k)));
  return JSON.stringify(args).length <= MAX_ARGS_CHARS ? args : { truncated: true };
}

/** What every row of one call shares. */
function baseRow(tool: Operation, input: Input, ctx: { client: string; callId: string; started: number; transport?: CallContext["transport"] }) {
  // crypto calls name coins, not a URL or a query: their symbols stand in for the query.
  const symbols = Array.isArray(input["symbols"]) ? input["symbols"].filter((s): s is string => typeof s === "string").join(",") : undefined;
  input = input["url"] === undefined && input["query"] === undefined && symbols ? { ...input, query: symbols } : input;
  const searchType = SearchTypeSchema.safeParse(input["type"] ?? (tool === Operation.Search ? "web" : undefined));
  return {
    time: new Date(ctx.started).toISOString(),
    client: ctx.client,
    call_id: ctx.callId,
    tool,
    ...(text(input["url"] ?? input["query"], MAX_QUERY_CHARS) ? { query: text(input["url"] ?? input["query"], MAX_QUERY_CHARS) } : {}),
    ...(hostOf(input["url"]) ? { domain: hostOf(input["url"]) } : {}),
    ...(tool === Operation.Search && searchType.success ? { search_type: searchType.data } : {}),
    args: argsOf(input),
    ...(ctx.transport ? { transport: ctx.transport } : {}),
    duration_ms: Math.max(0, Date.now() - ctx.started),
  };
}

function resultCount(result: Input): number | undefined {
  const list = result["results"] ?? result["matches"];
  return Array.isArray(list) ? list.length : undefined;
}

/** The rows for one finished call. */
export function rowsFor(
  tool: Operation,
  input: Input,
  outcome: { result?: Input; error?: unknown; costUsd: number; served?: { provider: string; parts?: Record<string, string> } },
  ctx: Parameters<typeof baseRow>[2],
): CallRow[] {
  const base = baseRow(tool, input, ctx);
  if (outcome.error !== undefined || !outcome.result) {
    const code = outcome.error instanceof McpyError ? outcome.error.code : ErrorCode.Internal;
    return [{ ...base, status: CallStatus.Error as Status, error: code, cache_hit: false, cost_usd: round(outcome.costUsd) }];
  }
  const meta = (outcome.result["meta"] ?? {}) as Meta;
  const parsed = CacheStatusSchema.safeParse(meta.cache);
  const cache = parsed.success ? parsed.data : undefined;
  const backend = (name: string | undefined) => (name && name !== "none" ? { backend: name } : {});
  const shared = { ...base, ...(cache ? { cache } : {}), cache_hit: cache === CacheStatus.Hit, ...(typeof meta.attempts === "number" ? { attempts: meta.attempts } : {}) };
  const parts = Object.entries(outcome.served?.parts ?? {});
  if (tool === Operation.CryptoCoin && parts.length) {
    // One row per coin and kind of day ("BTC complete", "BTC live") with the source behind it; the cost goes on the first.
    const { attempts: _all, ...perPart } = shared as typeof shared & { attempts?: number };
    return parts.map(([part, provider], i) => ({ ...perPart, store: part.slice(0, 64), ...backend(provider), status: CallStatus.Ok, cost_usd: i === 0 ? round(outcome.costUsd) : 0 }));
  }
  const reports = outcome.result["marketplaces"] as Report[] | undefined;
  if (tool !== Operation.Shopping || !Array.isArray(reports) || reports.length === 0) {
    return [{ ...shared, ...backend(outcome.served?.provider), status: CallStatus.Ok, cost_usd: round(outcome.costUsd), ...(resultCount(outcome.result) !== undefined ? { results: resultCount(outcome.result) } : {}) }];
  }
  // One row per store, each with its own cost; what no store accounts for goes on the first.
  const unassigned = Math.max(0, outcome.costUsd - reports.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0));
  // The call's attempt count covers every store: a store's row leaves it out rather than repeat it.
  const { attempts: _all, ...perStore } = shared as typeof shared & { attempts?: number };
  return reports.map((r, i) => {
    const status = CallStatusSchema.safeParse(r.status);
    return {
      ...perStore,
      store: r.marketplace,
      ...backend(outcome.served?.parts?.[r.marketplace]),
      ...(hostOf(r.search_url) ? { domain: hostOf(r.search_url) } : {}),
      status: status.success ? status.data : CallStatus.Failed,
      ...(r.failure || r.error ? { error: (r.failure ?? r.error)!.slice(0, 100) } : {}),
      cost_usd: round((r.cost_usd ?? 0) + (i === 0 ? unassigned : 0)),
      results: r.results,
    };
  });
}

/** A spend limit that also counts what one call spends. */
function counting(limit: SpendLimit | undefined): SpendLimit & { spent: () => number } {
  let spent = 0;
  return {
    spent: () => spent,
    allows: () => (limit ? limit.allows() : Promise.resolve(true)),
    record: (usd) => {
      spent += usd;
      return limit ? limit.record(usd) : Promise.resolve();
    },
  };
}

type Logged = Exclude<keyof McpyApi, "fetchBatch">;

const METHODS: Record<Logged, Operation> = {
  fetch: Operation.Fetch,
  grep: Operation.Grep,
  search: Operation.Search,
  papers: Operation.Papers,
  shopping: Operation.Shopping,
  shoppingItem: Operation.ShoppingItem,
  cryptoMarket: Operation.CryptoMarket,
  cryptoCoin: Operation.CryptoCoin,
};

/**
 * The SDK for one request, with every call logged as `client`. A batch is its
 * fetches, each logged as a fetch of its own; their rows are written together.
 */
export function recordingApi(mcpy: Mcpy, context: CallContext & { client: string }, write: (rows: CallRow[]) => void): McpyApi {
  const call = (method: Logged, writeRows: (rows: CallRow[]) => void, extra: CallContext = {}) => async (input: unknown) => {
    const started = Date.now();
    const spend = counting(context.spendLimit);
    let served: { provider: string; parts?: Record<string, string> } | undefined;
    const api = mcpy.with({ ...context, ...extra, spendLimit: spend, onServed: (s) => void (served = s) });
    const ctx = { client: context.client, callId: crypto.randomUUID(), started, transport: context.transport };
    const args = input && typeof input === "object" && !Array.isArray(input) ? (input as Input) : {};
    try {
      const result = (await (api[method] as (i: unknown) => Promise<unknown>)(input)) as Input;
      const meta = result["meta"];
      if (meta && typeof meta === "object") (meta as Record<string, unknown>)["call_id"] = ctx.callId; // the caller can trace an answer back to its log rows
      writeRows(rowsFor(METHODS[method], args, { result, costUsd: spend.spent(), served }, ctx));
      return result;
    } catch (error) {
      writeRows(rowsFor(METHODS[method], args, { error, costUsd: spend.spent() }, ctx));
      throw error;
    }
  };
  const api = Object.fromEntries(Object.keys(METHODS).map((m) => [m, call(m as Logged, write)])) as unknown as McpyApi;
  api.fetchBatch = async (input) => {
    const rows: CallRow[] = [];
    const push = (r: CallRow[]) => void rows.push(...r);
    try {
      return await runFetchBatch((request, admit) => call("fetch", push, { admit })(request) as ReturnType<McpyApi["fetch"]>, input);
    } finally {
      if (rows.length) write(rows);
    }
  };
  return api;
}
