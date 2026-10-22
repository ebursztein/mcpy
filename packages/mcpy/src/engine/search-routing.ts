import { ErrorCode } from "../enums.js";
import { McpyError } from "../errors.js";
import type { SearchProvider, SearchRequest } from "../providers/types.js";

/** Why a provider cannot serve a request; undefined when it can. */
function gap(provider: SearchProvider, req: SearchRequest): string | undefined {
  const caps = provider.capabilities;
  if (!caps.types.includes(req.type)) return `type ${req.type}`;
  if (req.recency && !caps.recency) return "recency";
  if ((req.sites || req.excludeSites) && !caps.sites) return "site filters";
  if (req.page * req.limit > caps.maxDepth) return `results beyond ${caps.maxDepth}`;
  return undefined;
}

/**
 * Providers able to serve the request, in configured order. Hard
 * requirements (type, recency, site filters, depth) filter providers out;
 * country, language and device are hints a provider may ignore.
 */
export function capableProviders(providers: SearchProvider[], req: SearchRequest): SearchProvider[] {
  if (providers.length === 0) throw new McpyError(ErrorCode.NoProviders, "no search sources are configured");
  const capable = providers.filter((p) => gap(p, req) === undefined);
  if (capable.length === 0) {
    // Name the missing capabilities, never the providers.
    const missing = [...new Set(providers.map((p) => gap(p, req)).filter((g): g is string => !!g))];
    throw new McpyError(ErrorCode.InvalidInput, "no configured search source supports this request", missing.map((m) => `unsupported: ${m}`));
  }
  return capable;
}
