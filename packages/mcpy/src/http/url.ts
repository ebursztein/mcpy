import { ErrorCode } from "../enums.js";
import { McpyError } from "../errors.js";

const PRIVATE_HOST = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.home\.arpa$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT
  /^0\./,
];

/** IPv6 literals (brackets stripped) that are loopback, unspecified, private or IPv4-mapped. */
const PRIVATE_IPV6 = [/^::1?$/, /^f[cd][0-9a-f]{2}:/i, /^fe[89ab][0-9a-f]:/i, /^::ffff:/i];

/** Lowercased host with brackets and a trailing root dot removed ("localhost." is "localhost"). */
function canonicalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

export function isPrivateHost(hostname: string): boolean {
  const host = canonicalHost(hostname);
  if (host.includes(":")) return PRIVATE_IPV6.some((re) => re.test(host));
  return PRIVATE_HOST.some((re) => re.test(host));
}

/**
 * Accept only public http(s) URLs. Workers cannot reach private networks,
 * but paid providers might, and there is no reason to proxy such requests.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpyError(ErrorCode.InvalidTarget, `invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new McpyError(ErrorCode.InvalidTarget, `unsupported scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new McpyError(ErrorCode.InvalidTarget, "URLs with credentials are not allowed");
  }
  if (isPrivateHost(url.hostname)) {
    throw new McpyError(ErrorCode.InvalidTarget, `refusing private or local host: ${url.hostname}`);
  }
  return url;
}

/** Stable cache identity for a URL: drop the fragment, sort query params. */
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isHtml(contentType: string): boolean {
  return /text\/html|application\/xhtml/i.test(contentType);
}

export function isMarkdown(contentType: string): boolean {
  return /markdown/i.test(contentType);
}

export function isTextual(contentType: string): boolean {
  if (!contentType) return true;
  return /^text\/|json|xml|javascript|ecmascript|yaml|csv|markdown/i.test(contentType);
}

/** host + path only: safe to log (queries may carry tokens). */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}
