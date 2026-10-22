// Worker entry point. Only the default handler may be exported from this
// module (workerd rejects other named exports); shared wiring lives in app.ts.

import { createMcpHandler } from "agents/mcp/server";
import { handleApi } from "./api";
import { buildMcpServer, buildWebService, SERVER_NAME, SERVER_VERSION } from "./app";
import { authorize, stripUrlKey } from "./auth";
import { loadConfig, type Env } from "./config";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION });

    const isMcp = url.pathname === "/mcp";
    const isApi = url.pathname.startsWith("/v1/");
    if (!isMcp && !isApi) return new Response("Not found", { status: 404 });

    const config = loadConfig(env);
    // CORS preflight carries no credentials and runs no tools.
    if (!(isMcp && request.method === "OPTIONS")) {
      const auth = await authorize(request, url, config);
      if (!auth.ok) return auth.response;
    }

    const web = buildWebService(env, config);
    if (isApi) return handleApi(request, url, web);

    const handler = createMcpHandler(() => buildMcpServer(web), {
      route: "/mcp",
      allowedHostnames: config.allowedHostnames,
    });
    return handler(stripUrlKey(request, url), env, ctx);
  },
} satisfies ExportedHandler<Env>;
