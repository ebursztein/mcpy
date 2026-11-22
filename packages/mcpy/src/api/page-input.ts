/**
 * Fetch and grep input -> the page request the engine serves. The rules that
 * JSON Schema cannot express live here, so REST, MCP and the SDK share them.
 */

import { ErrorCode, HttpMethod, type PageFormat, type UserAgentProfile } from "../enums.js";
import { McpyError } from "../errors.js";
import { assertPublicHttpUrl } from "../http/url.js";
import type { PageRequest } from "../providers/types.js";
import { MAX_REQUEST_HEADERS } from "../schemas.js";

/**
 * Headers a caller may not set: they describe the connection or the body
 * framing, which mcpy's HTTP client owns, or they would address a proxy.
 */
const REFUSED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
]);

export interface PageInput {
  url: string;
  format: PageFormat;
  user_agent?: UserAgentProfile;
  render: boolean;
  wait_ms?: number;
  method: HttpMethod;
  body?: string;
  headers?: Record<string, string>;
}

const invalid = (message: string) => new McpyError(ErrorCode.InvalidInput, message);

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function checkedHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const entries = Object.entries(headers ?? {});
  if (entries.length > MAX_REQUEST_HEADERS) throw invalid(`at most ${MAX_REQUEST_HEADERS} headers`);
  const seen = new Set<string>();
  for (const [name, value] of entries) {
    const lower = name.toLowerCase();
    if (REFUSED_HEADERS.has(lower)) throw invalid(`header ${name} is set by mcpy and cannot be sent`);
    if (seen.has(lower)) throw invalid(`header ${name} is given twice`);
    if (/[\r\n\0]/.test(value)) throw invalid(`header ${name} has a line break or NUL in its value`);
    seen.add(lower);
  }
  return Object.fromEntries(entries);
}

export function pageRequestOf(input: PageInput, defaultUserAgent: UserAgentProfile): PageRequest {
  const url = assertPublicHttpUrl(input.url).toString();
  const post = input.method === HttpMethod.Post;
  if (input.body !== undefined && !post) throw invalid("body needs method POST");
  if (input.render && post) throw invalid("render works with GET only");
  if (input.wait_ms !== undefined && !input.render) throw invalid("wait_ms needs render: true");

  const headers = checkedHeaders(input.headers);
  const typed = Object.keys(headers).some((name) => name.toLowerCase() === "content-type");
  if (post && input.body !== undefined && !typed && isJson(input.body)) headers["Content-Type"] = "application/json";
  return {
    url,
    format: input.format,
    userAgent: input.user_agent ?? defaultUserAgent,
    ...(post ? { method: HttpMethod.Post } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(input.render ? { render: true } : {}),
    ...(input.wait_ms !== undefined ? { waitMs: input.wait_ms } : {}),
  };
}
