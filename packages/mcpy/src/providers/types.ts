/**
 * Provider contracts. The engine is the only caller; the public API never
 * names a provider. Implement these to add a backend.
 */

import { z } from "zod";
import type { PageFormat, UserAgentProfile } from "../enums.js";
import type { HttpClient, HttpContext } from "../http/client.js";

/** Ids of the built-in providers (custom providers may use their own). */
export const ProviderId = {
  Direct: "direct",
  CloudflareBrowser: "cloudflare_browser",
  Firecrawl: "firecrawl",
  BrightData: "brightdata",
} as const;
export const ProviderIdSchema = z.enum([ProviderId.Direct, ProviderId.CloudflareBrowser, ProviderId.Firecrawl, ProviderId.BrightData]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export interface PageRequest {
  url: string;
  format: PageFormat;
  userAgent: UserAgentProfile;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  /** HTTP status of the target page (0 when the provider does not report it). */
  status: number;
  contentType: string;
  title?: string;
  /** In the requested format. */
  content: string;
  format: PageFormat;
}

export interface SearchRequest {
  query: string;
  limit: number;
}

export interface FoundPage {
  url: string;
  title: string;
  snippet: string;
}

/** What the engine hands a provider for one attempt. */
export interface ProviderCall {
  http: HttpClient;
  context: HttpContext;
  /** Resolves a user-agent profile to its header value. */
  userAgent(profile: UserAgentProfile): string;
  /** Time left for this attempt, for providers that take a timeout parameter. */
  timeoutMs: number;
}

interface ProviderBase {
  readonly id: string;
  /** Estimated USD per call, for cost telemetry. */
  readonly costPerCall: number;
}

export interface PageProvider extends ProviderBase {
  fetchPage(req: PageRequest, call: ProviderCall): Promise<FetchedPage>;
}

export interface SearchProvider extends ProviderBase {
  search(req: SearchRequest, call: ProviderCall): Promise<FoundPage[]>;
}
