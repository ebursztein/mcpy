/** Shared HTTP helpers: bounded body reads and URL safety checks. */

export class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`response body exceeds ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/** Read a response body as text, aborting once it exceeds maxBytes. */
export async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new BodyTooLargeError(maxBytes);
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError(maxBytes);
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/** The caller asked for a URL we will not fetch (maps to HTTP 400). */
export class InvalidTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTargetError";
  }
}

const PRIVATE_HOST = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

/**
 * Accept only public http(s) URLs. Workers cannot reach private networks,
 * but paid providers might, and there is no reason to proxy such requests.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidTargetError(`invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidTargetError(`unsupported scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new InvalidTargetError("URLs with credentials are not allowed");
  }
  if (PRIVATE_HOST.some((re) => re.test(url.hostname))) {
    throw new InvalidTargetError(`refusing private or local host: ${url.hostname}`);
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

export function isTextual(contentType: string): boolean {
  if (!contentType) return true;
  return /^text\/|json|xml|javascript|ecmascript|yaml|csv|markdown/i.test(contentType);
}
