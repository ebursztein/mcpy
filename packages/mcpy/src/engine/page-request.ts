/**
 * What a page request needs from a provider, and how it is keyed. A plain
 * GET goes to every page provider; rendering, another method or extra headers
 * go only to the providers that declare they can do it, so a request is never
 * silently served without what it asked for.
 */

import { ErrorCode, HttpMethod } from "../enums.js";
import { McpyError } from "../errors.js";
import { isSafeMethod } from "../http/methods.js";
import { normalizeUrl, sha256Hex } from "../http/url.js";
import type { PageProvider, PageRequest } from "../providers/types.js";
import { siteOf } from "./routes.js";

/** Any method but GET: HEAD, POST, PUT, PATCH, DELETE. */
const otherMethod = (req: PageRequest) => req.method !== undefined && req.method !== HttpMethod.Get;
const hasHeaders = (req: PageRequest) => Object.keys(req.headers ?? {}).length > 0;

/** A GET with nothing extra: what every page provider can serve. */
function isPlain(req: PageRequest): boolean {
  return !req.render && !otherMethod(req) && req.body === undefined && !hasHeaders(req) && !req.country;
}

/**
 * Cache id of a page request (its key: `v2:page:<id>`). Every field that can
 * change the answer is part of it. A read's answer is shared by every client;
 * a write's is kept for the client that sent it (`client`), so one client's
 * write never answers another's.
 */
export async function pageCacheId(req: PageRequest, client?: string): Promise<string> {
  const base = `${req.format}:${req.userAgent}`;
  const url = normalizeUrl(req.url);
  // Plain GETs keep the key they always had, so cached pages and page versions still match.
  if (isPlain(req)) return `${base}:${await sha256Hex(url)}`;
  const headers = Object.entries(req.headers ?? {})
    .map(([name, value]) => [name.toLowerCase(), value])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const owner = isSafeMethod(req.method) ? [] : [{ client: client ?? null }];
  const identity = [url, req.method ?? HttpMethod.Get, req.body ?? null, headers, req.render ?? false, req.waitMs ?? 0, ...(req.country ? [req.country] : []), ...owner];
  return `${base}:req:${await sha256Hex(JSON.stringify(identity))}`;
}

/** The providers that can serve this request, in configured order. */
export function capablePageProviders(providers: readonly PageProvider[], req: PageRequest): PageProvider[] {
  return providers.filter((p) => {
    const can = p.capabilities ?? {};
    if (req.render && !can.render) return false;
    if (otherMethod(req) && !can.methods?.includes(req.method!)) return false;
    return !hasHeaders(req) || can.headers === true;
  });
}

/** The error when no configured provider can do what the request asks. */
export function noCapableProvider(req: PageRequest): McpyError {
  const needs = [req.render && "render pages", otherMethod(req) && `send ${req.method} requests`, hasHeaders(req) && "send custom headers"].filter(Boolean);
  return new McpyError(ErrorCode.NoProviders, `no source on this server can ${needs.join(" and ")}`);
}

/**
 * The site whose route memory this request reads and teaches. Rendered pages
 * keep their own memory (the providers that render are not the ones that
 * fetch); other methods have none, as only a direct request can send one.
 */
export function routeSite(req: PageRequest): string | undefined {
  if (otherMethod(req)) return undefined;
  return siteOf(req.url, req.render ? `${req.format}+render` : req.format);
}
