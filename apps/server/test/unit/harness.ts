/**
 * Drives the Worker's default export in Node: env objects, a stub
 * ExecutionContext, a stub network (canned article + OTLP collector) and
 * MCP JSON-RPC helpers. No real network is touched.
 */

import { vi } from "vitest";
import worker from "../../src/index.js";
import type { Env } from "../../src/env.js";

export const USER_KEY = "user-key-0123456789abcdef";
export const ADMIN_KEY = "admin-key-0123456789abcdef";
export const MCPY_CLIENTS = `alice:${USER_KEY},ops:${ADMIN_KEY}:admin`;
export const BASE = "https://mcpy.test";
export const ARTICLE_HOST = "news.example.org";
export const OTLP_ENDPOINT = "https://otel.example.net";
export const ARTICLE_TITLE = "Gardens of the Northern Coast";

const PARAGRAPH =
  "The northern coast keeps its gardens behind stone walls, where salt winds cannot reach the roses. " +
  "Gardeners there plant in late spring and harvest herbs well into autumn, trading seeds every market day.";

export const ARTICLE_HTML = `<!doctype html><html><head><title>${ARTICLE_TITLE}</title></head><body>
<nav><a href="/">Home</a></nav>
<article><h1>${ARTICLE_TITLE}</h1>
${Array.from({ length: 12 }, (_, i) => `<p>Section ${i + 1}. ${PARAGRAPH}</p>`).join("\n")}
<p>Maintained by the coastal mcpy garden society.</p>
</article></body></html>`;

/** A fresh article URL: the isolate cache is shared, so each test uses its own page. */
let pageCounter = 0;
export const articleUrl = (label = "page") => `https://${ARTICLE_HOST}/${label}-${++pageCounter}-${Date.now()}`;

export interface OtlpPost {
  path: string;
  body: OtlpBody;
}
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
}
export interface OtlpBody {
  resourceSpans?: { scopeSpans: { spans: OtlpSpan[] }[] }[];
}

/** Stub global fetch: serves the article, records OTLP posts, 404s anything else. */
export function stubNetwork() {
  const upstream: string[] = [];
  const otlp: OtlpPost[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(OTLP_ENDPOINT)) {
      otlp.push({ path: new URL(url).pathname, body: JSON.parse(String(init?.body)) as OtlpBody });
      return new Response("{}", { status: 200 });
    }
    upstream.push(url);
    const host = new URL(url).hostname;
    const res =
      host === ARTICLE_HOST || host === "[::ffff:7f00:1]"
        ? new Response(ARTICLE_HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })
        : new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    Object.defineProperty(res, "url", { value: url });
    return res;
  });
  vi.stubGlobal("fetch", fetchStub);
  return { upstream, otlp, fetchStub };
}

/** A new env object (config and SDK are memoized per env object). */
export function makeEnv(vars: Record<string, unknown> = {}): Env {
  return { MCPY_CLIENTS, PAGE_PROVIDERS: "direct", SEARCH_PROVIDERS: "firecrawl", RETRIES: "0", ...vars };
}

export interface StubCtx extends ExecutionContext {
  pending: Promise<unknown>[];
  settle(): Promise<void>;
}

export function makeCtx(): StubCtx {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => undefined,
    props: {},
    async settle() {
      await Promise.all(pending);
    },
  } as unknown as StubCtx;
}

export interface CallOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  key?: string | null;
  env?: Env;
  ctx?: StubCtx;
}

/** Call the Worker; authenticates with the user key via Bearer unless `key` says otherwise. */
export async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  const key = options.key === undefined ? USER_KEY : options.key;
  if (key) headers.Authorization = `Bearer ${key}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const request = new Request(`${BASE}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
  const ctx = options.ctx ?? makeCtx();
  const response = await worker.fetch(request, options.env ?? makeEnv(), ctx);
  // Like the runtime: the client reads the body first, then waitUntil work
  // (telemetry flush after the body has been sent) completes.
  const body = await response.arrayBuffer();
  await ctx.settle();
  return new Response(body, response);
}

const MCP_HEADERS = { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" };
let rpcId = 0;

/** JSON-RPC result of one MCP call; handles JSON and SSE responses. */
export async function rpc(method: string, params: unknown, options: CallOptions = {}): Promise<{ response: Response; message: RpcMessage }> {
  const response = await call("/mcp", {
    ...options,
    method: "POST",
    headers: { ...MCP_HEADERS, ...options.headers },
    body: { jsonrpc: "2.0", id: ++rpcId, method, params },
  });
  return { response, message: await readRpc(response) };
}

export interface RpcMessage {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export async function readRpc(response: Response): Promise<RpcMessage> {
  const text = await response.text();
  if (!(response.headers.get("Content-Type") ?? "").includes("text/event-stream")) return JSON.parse(text) as RpcMessage;
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return JSON.parse(data[data.length - 1]) as RpcMessage;
}

export const INITIALIZE = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "mcpy-tests", version: "0.0.0" },
};

/** Every JSON line written to console.log while `fn` runs. */
export async function captureLogs<T>(fn: () => Promise<T>): Promise<{ value: T; lines: Record<string, unknown>[] }> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const value = await fn();
    const lines = spy.mock.calls.flatMap(([first]) => {
      try {
        const parsed: unknown = JSON.parse(String(first));
        return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
      } catch {
        return [];
      }
    });
    return { value, lines };
  } finally {
    spy.mockRestore();
  }
}
