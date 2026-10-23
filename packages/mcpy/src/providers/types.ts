/**
 * Provider contracts. The engine is the only caller; the public API never
 * names a provider. Implement these to add a backend.
 */

import { z } from "zod";
import { UserAgentProfile, type ContentKind, type Device, type PageFormat, type Recency, type SearchType } from "../enums.js";
import type { HttpClient, HttpContext } from "../http/client.js";

/** Ids of the built-in providers (custom providers may use their own). */
export const ProviderId = {
  Direct: "direct",
  CloudflareBrowser: "cloudflare_browser",
  Firecrawl: "firecrawl",
  BrightData: "brightdata",
  OpenAlex: "openalex",
  Arxiv: "arxiv",
  SemanticScholar: "semantic_scholar",
  PubMed: "pubmed",
} as const;
export const ProviderIdSchema = z.enum([
  ProviderId.Direct,
  ProviderId.CloudflareBrowser,
  ProviderId.Firecrawl,
  ProviderId.BrightData,
  ProviderId.OpenAlex,
  ProviderId.Arxiv,
  ProviderId.SemanticScholar,
  ProviderId.PubMed,
]);
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
  /** What the content was produced from; drives quality judgement. */
  kind: ContentKind;
  title?: string;
  /** In the requested format. */
  content: string;
  format: PageFormat;
}

/** A search as the engine hands it to a provider (already validated). */
export interface SearchRequest {
  query: string;
  type: SearchType;
  /** Results wanted on this page. */
  limit: number;
  /** 1-based page: skip (page - 1) * limit results. */
  page: number;
  country?: string;
  language?: string;
  recency?: Recency;
  device?: Device;
  sites?: string[];
  excludeSites?: string[];
}

/** One result as a provider found it. Optional fields depend on the type. */
export interface FoundPage {
  url: string;
  title: string;
  snippet: string;
  date?: string;
  publisher?: string;
  image?: string;
  price?: string;
  rating?: number;
  reviews?: number;
  address?: string;
  phone?: string;
  company?: string;
  location?: string;
  duration?: string;
}

/**
 * What a search provider can honor. The engine only routes a search to
 * providers that support its type and its hard filters (recency, sites, and
 * the requested depth). Country, language and device are best-effort hints.
 */
export interface SearchCapabilities {
  types: readonly SearchType[];
  recency: boolean;
  sites: boolean;
  country: boolean;
  language: boolean;
  device: boolean;
  /** Deepest result reachable: page * limit must not exceed it. */
  maxDepth: number;
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
  /**
   * Whether thrown failures count toward this provider's circuit breaker
   * (default true). Set false when failures reflect the target site rather
   * than the provider's own health, as for a direct fetch.
   */
  readonly circuitBreaker?: boolean;
  /**
   * Attempt budget this provider needs when it is longer than the engine's
   * default (e.g. SERP APIs that take tens of seconds). Still capped by the
   * operation deadline.
   */
  readonly attemptTimeoutMs?: number;
}

export interface PageProvider extends ProviderBase {
  fetchPage(req: PageRequest, call: ProviderCall): Promise<FetchedPage>;
}

export interface SearchProvider extends ProviderBase {
  readonly capabilities: SearchCapabilities;
  search(req: SearchRequest, call: ProviderCall): Promise<FoundPage[]>;
}

/**
 * User agent to forward to a hosted browser (Firecrawl, Browser Run), or
 * undefined to let it use its own. Forwarding our honest `default` agent
 * defeats their stealth browsers: verified live, Firecrawl failed on a
 * Vercel-protected site with it and succeeded in 4 s without it.
 */
export function forwardedUserAgent(req: PageRequest, call: ProviderCall): string | undefined {
  return req.userAgent === UserAgentProfile.Default ? undefined : call.userAgent(req.userAgent);
}
