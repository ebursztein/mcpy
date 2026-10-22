/**
 * Provider contracts. Tools only ever talk to these interfaces; each backend
 * (Cloudflare, Firecrawl, Bright Data, ...) is an adapter behind them, so
 * adding or reordering backends never touches tool code.
 */

import type { Config, Env } from "../config";

export type PageFormat = "markdown" | "html";

export interface FetchRequest {
  url: string;
  format: PageFormat;
  timeoutMs: number;
}

export interface FetchedPage {
  url: string; // requested URL
  finalUrl: string; // after redirects, when the provider reports it
  status: number; // HTTP status of the target page (0 when unknown)
  contentType: string;
  title?: string;
  content: string; // in the requested format
  format: PageFormat;
}

export interface SearchRequest {
  query: string;
  limit: number;
  timeoutMs: number;
}

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

interface ProviderBase {
  readonly id: string;
  /** Estimated USD per call, for cost telemetry. */
  readonly costPerCall: number;
}

export interface FetchProvider extends ProviderBase {
  fetch(req: FetchRequest, signal: AbortSignal): Promise<FetchedPage>;
}

export interface SearchProvider extends ProviderBase {
  search(req: SearchRequest, signal: AbortSignal): Promise<SearchHit[]>;
}

export interface ProviderDeps {
  env: Env;
  config: Config;
  /** Injected so tests can stub the network. */
  fetch: typeof fetch;
}

/**
 * A factory returns null when its credentials are missing, which disables
 * the provider instead of failing at call time.
 */
export interface ProviderFactory<P> {
  readonly id: string;
  create(deps: ProviderDeps): P | null;
}

/** Raised by adapters for failures worth reporting with context. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}
