import { McpServer } from "@modelcontextprotocol/server";
import type { Config, Env } from "./config";
import { KvCache, NoCache } from "./core/cache";
import { WebService } from "./core/service";
import { AnalyticsTelemetry } from "./core/telemetry";
import { resolveFetchProviders, resolveSearchProviders } from "./providers/registry";
import { registerWebTools } from "./tools/web";

export const SERVER_NAME = "toolshed";
export const SERVER_VERSION = "0.1.0";

/** Wire config, providers, cache and telemetry into the shared service. */
export function buildWebService(env: Env, config: Config): WebService {
  const deps = { env, config, fetch: globalThis.fetch.bind(globalThis) };
  return new WebService(
    config,
    resolveFetchProviders(deps),
    resolveSearchProviders(deps),
    env.CACHE ? new KvCache(env.CACHE) : new NoCache(),
    new AnalyticsTelemetry(env.TELEMETRY),
  );
}

export function buildMcpServer(web: WebService): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerWebTools(server, web);
  return server;
}
