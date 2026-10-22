/**
 * `mcpy/client`: typed client for a hosted mcpy server's REST API. Same
 * McpyApi as the in-process SDK, so code can switch between them.
 */

import type { z } from "zod";
import { RestRoute } from "./api/routes.js";
import { ErrorCode } from "./enums.js";
import { McpyError } from "./errors.js";
import {
  ErrorBodySchema,
  FetchInputSchema,
  FetchResultSchema,
  GrepInputSchema,
  GrepResultSchema,
  SearchInputSchema,
  SearchResultSchema,
  type FetchInput,
  type FetchResult,
  type GrepInput,
  type GrepResult,
  type McpyApi,
  type SearchInput,
  type SearchResult,
} from "./schemas.js";

export interface McpyClientOptions {
  /** e.g. https://tools.example.com */
  baseUrl: string;
  apiKey: string;
  /** Client-side timeout per call. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 90_000;

export class McpyClient implements McpyApi {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: McpyClientOptions) {
    this.base = options.baseUrl.replace(/\/$/, "");
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  fetch(input: FetchInput): Promise<FetchResult> {
    return this.post(RestRoute.Fetch, FetchInputSchema, FetchResultSchema, input);
  }

  grep(input: GrepInput): Promise<GrepResult> {
    return this.post(RestRoute.Grep, GrepInputSchema, GrepResultSchema, input);
  }

  search(input: SearchInput): Promise<SearchResult> {
    return this.post(RestRoute.Search, SearchInputSchema, SearchResultSchema, input);
  }

  private async post<I extends z.ZodType, O extends z.ZodType>(route: RestRoute, inSchema: I, outSchema: O, input: unknown): Promise<z.infer<O>> {
    // Fail fast locally with the same validation the server applies.
    const parsed = inSchema.safeParse(input);
    if (!parsed.success) {
      throw new McpyError(
        ErrorCode.InvalidInput,
        "invalid input",
        parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`),
      );
    }

    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${route}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      throw new McpyError(timeout ? ErrorCode.Timeout : ErrorCode.UpstreamFailed, timeout ? "request timed out" : "could not reach mcpy server");
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      // The timeout also covers the body download.
      if (err instanceof Error && err.name === "TimeoutError") throw new McpyError(ErrorCode.Timeout, "request timed out");
      body = undefined;
    }
    if (!res.ok) {
      const error = ErrorBodySchema.safeParse(body);
      if (error.success) throw new McpyError(error.data.error.code, error.data.error.message, error.data.error.details);
      throw new McpyError(ErrorCode.BadResponse, `server returned HTTP ${res.status}`);
    }
    const out = outSchema.safeParse(body);
    if (!out.success) throw new McpyError(ErrorCode.BadResponse, "server response did not match the schema");
    return out.data;
  }
}
