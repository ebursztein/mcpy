// Worker entry point. Only the default handler may be exported from this
// module: workerd rejects other named exports.

import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { ErrorCode, LogLevel, McpyError, SpanName, SpanStatus, Transport } from "mcpy";
import { registerMcpyTools } from "mcpy/mcp";
import { Attr, parseTraceparent } from "mcpy/telemetry";
import { ANONYMOUS, extractKey, findClient, parseClients, stripUrlKey, type Client } from "./clients.js";
import { ConfigError, loadEnv, type Env, type ServerEnv } from "./env.js";
import { sdkFor } from "./mcpy.js";
import { errorResponse, handleRest, json } from "./rest.js";
import { requestTelemetry, SERVICE_VERSION } from "./telemetry.js";

const Path = { Health: "/health", Mcp: "/mcp", ApiPrefix: "/v1/" } as const;

async function authenticate(request: Request, url: URL, env: Env): Promise<Client | undefined> {
  const config = loadEnv(env);
  if (config.ALLOW_ANONYMOUS) return ANONYMOUS;
  return findClient(parseClients(config.MCPY_CLIENTS), extractKey(request, url));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === Path.Health) return json({ ok: true, name: "mcpy", version: SERVICE_VERSION });

    const isMcp = url.pathname === Path.Mcp;
    if (!isMcp && !url.pathname.startsWith(Path.ApiPrefix)) return errorResponse(new McpyError(ErrorCode.NotFound, "not found"));

    let config;
    try {
      config = loadEnv(env);
    } catch (err) {
      console.error(JSON.stringify({ level: LogLevel.Error, message: "configuration error", detail: err instanceof ConfigError ? err.issues : String(err) }));
      return errorResponse(new McpyError(ErrorCode.Internal, "server misconfigured"));
    }

    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const ids = { "X-Request-Id": requestId };
    const base = requestTelemetry(env, config).with({ [Attr.RequestId]: requestId });
    const span = base.startSpan(
      SpanName.Request,
      { [Attr.HttpMethod]: request.method, [Attr.HttpRoute]: url.pathname, [Attr.Transport]: isMcp ? Transport.Mcp : Transport.Rest },
      parseTraceparent(request.headers.get("traceparent")),
    );
    // End the span and export telemetry when the body has been fully sent:
    // MCP replies stream, and the tool runs while the stream is read.
    const finish = (response: Response) =>
      afterBody(response, ctx, () => {
        span.setAttributes({ [Attr.HttpStatus]: response.status });
        span.end(response.status >= 500 ? SpanStatus.Error : SpanStatus.Ok);
        return base.flush();
      });

    try {
      // CORS preflight carries no credentials and runs nothing.
      if (isMcp && request.method === "OPTIONS") return finish(await mcpHandler(config)(request, env, ctx));

      const client = await authenticate(request, url, env);
      if (!client) return finish(errorResponse(new McpyError(ErrorCode.Unauthorized, "missing or invalid API key"), { ...ids, "WWW-Authenticate": 'Bearer realm="mcpy"' }));
      span.setAttributes({ [Attr.ClientName]: client.name });
      const telemetry = base.with({ [Attr.ClientName]: client.name });

      if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: client.name })).success) {
        telemetry.log(LogLevel.Warn, "rate limited", {}, span.context);
        return finish(errorResponse(new McpyError(ErrorCode.RateLimited, "rate limit exceeded"), { ...ids, "Retry-After": "60" }));
      }

      const { mcpy, providers } = sdkFor(env, config, telemetry);
      const api = mcpy.with({ client: client.name, requestId, transport: isMcp ? Transport.Mcp : Transport.Rest, parent: span.context });

      if (!isMcp) return finish(withHeaders(await handleRest(request, url, api, client, providers), ids));
      return finish(withHeaders(await mcpHandler(config, api)(stripUrlKey(request, url), env, ctx), ids));
    } catch (err) {
      span.recordError(err);
      base.log(LogLevel.Error, "unhandled error", { [Attr.Reason]: err instanceof Error ? err.message : String(err) }, span.context);
      return finish(errorResponse(new McpyError(ErrorCode.Internal, "internal error"), ids));
    }
  },
} satisfies ExportedHandler<Env>;

function mcpHandler(config: ServerEnv, api?: Parameters<typeof registerMcpyTools>[1]) {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: "mcpy", version: SERVICE_VERSION });
      if (api) registerMcpyTools(server, api);
      return server;
    },
    {
      route: Path.Mcp,
      allowedHostnames: config.ALLOWED_HOSTNAMES.length ? config.ALLOWED_HOSTNAMES : undefined,
      allowedOriginHostnames: config.ALLOWED_ORIGIN_HOSTNAMES.length ? config.ALLOWED_ORIGIN_HOSTNAMES : undefined,
    },
  );
}

/** Pass the body through and run `done` once it has been fully sent (or the client went away). */
function afterBody(response: Response, ctx: ExecutionContext, done: () => Promise<void>): Response {
  if (!response.body) {
    ctx.waitUntil(done());
    return response;
  }
  const { readable, writable } = new TransformStream();
  ctx.waitUntil(response.body.pipeTo(writable).catch(() => undefined).then(done));
  return new Response(readable, response);
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
