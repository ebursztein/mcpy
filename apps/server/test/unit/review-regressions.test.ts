/**
 * Server regressions for the Fable review (2026-10-22). Never delete one.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode, ErrorBodySchema, RestRoute } from "mcpy";
import { articleUrl, call, captureLogs, makeEnv, stubNetwork, USER_KEY } from "./harness.js";

beforeEach(() => void stubNetwork());
afterEach(() => vi.unstubAllGlobals());

describe("#6 API keys passed in the URL", () => {
  it("never appear in any structured log line", async () => {
    const env = makeEnv({ LOG_LEVEL: "debug" });
    const path = `${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl("urlkey"))}&key=${USER_KEY}`;
    const { value: response, lines } = await captureLogs(() => call(path, { env, key: null }));
    expect(response.status).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(JSON.stringify(line)).not.toContain(USER_KEY);
  });

  it("are not captured by Cloudflare invocation logs (which record full URLs)", () => {
    const config = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    expect(config).toMatch(/"invocation_logs":\s*false/);
    expect(config).not.toMatch(/"invocation_logs":\s*true/);
  });
});

describe("#6 failed authentications are rate-limited per client IP", () => {
  it("answers 429 once the auth limiter is exhausted, keyed by IP", async () => {
    const keys: string[] = [];
    let remaining = 2;
    const env = makeEnv({ AUTH_LIMITER: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: remaining-- > 0 }) } });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await call(RestRoute.Fetch, { env, key: "wrong-key-wrong-key-wrong-key", headers: { "cf-connecting-ip": "203.0.113.9" } });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 429]);
    expect(keys).toEqual(Array(3).fill("auth:203.0.113.9"));
  });

  it("does not count successful requests against the auth limiter", async () => {
    let calls = 0;
    const env = makeEnv({ AUTH_LIMITER: { limit: async () => (calls++, { success: true }) } });
    await call(`${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl("ok"))}`, { env });
    expect(calls).toBe(0);
  });
});

describe("admin route and origins", () => {
  it("answers 403 forbidden (not 401) for an authenticated non-admin client", async () => {
    const res = await call("/v1/admin/providers");
    expect(res.status).toBe(403);
    expect(ErrorBodySchema.parse(await res.json()).error.code).toBe(ErrorCode.Forbidden);
  });

  it("lets operators allow extra browser origins for /mcp", async () => {
    const env = makeEnv({ ALLOWED_ORIGIN_HOSTNAMES: "app.example.com" });
    const preflight = (origin: string) =>
      call("/mcp", { env, method: "OPTIONS", key: null, headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
    expect((await preflight("https://app.example.com")).status).toBeLessThan(400);
    expect((await preflight("https://evil.example.net")).status).toBe(403);
  });
});
