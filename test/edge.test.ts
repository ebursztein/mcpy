import { describe, expect, it } from "vitest";
import { authorize, stripUrlKey } from "../src/auth";
import { loadConfig } from "../src/config";
import { grepLines, paginate } from "../src/lib/text";
import worker from "../src/index";

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

describe("authorize", () => {
  const req = (auth?: string) => new Request("https://t/mcp", { headers: auth ? { Authorization: auth } : {} });
  const u = new URL("https://t/mcp");

  it("fails closed when no tokens are configured", async () => {
    expect((await authorize(req("Bearer x"), u, loadConfig({}))).ok).toBe(false);
  });
  it("accepts any configured token and rejects others", async () => {
    const config = loadConfig({ AUTH_TOKENS: "alpha, beta" });
    expect((await authorize(req("Bearer beta"), u, config)).ok).toBe(true);
    expect((await authorize(req("Bearer gamma"), u, config)).ok).toBe(false);
    expect((await authorize(req(), u, config)).ok).toBe(false);
  });
  it("accepts X-API-Key and ?key=, and strips the URL key", async () => {
    const config = loadConfig({ AUTH_TOKENS: "alpha" });
    const h = new Request("https://t/v1/providers", { headers: { "X-API-Key": "alpha" } });
    expect((await authorize(h, new URL(h.url), config)).ok).toBe(true);
    const q = new Request("https://t/mcp?key=alpha&x=1");
    expect((await authorize(q, new URL(q.url), config)).ok).toBe(true);
    expect(stripUrlKey(q, new URL(q.url)).url).toBe("https://t/mcp?x=1");
  });
  it("allows anonymous only when explicitly enabled", async () => {
    expect((await authorize(req(), u, loadConfig({ ALLOW_ANONYMOUS: "true" }))).ok).toBe(true);
  });
});

describe("worker routing", () => {
  it("serves health without auth and gates /mcp", async () => {
    const health = await worker.fetch(new Request("http://localhost/health"), {}, ctx);
    expect(health.status).toBe(200);
    const mcp = await worker.fetch(new Request("http://localhost/mcp", { method: "POST", body: "{}" }), {}, ctx);
    expect(mcp.status).toBe(401);
  });

  it("serves the REST API with key auth and validation", async () => {
    const env = { AUTH_TOKENS: "alpha" };
    const denied = await worker.fetch(new Request("http://localhost/v1/providers"), env, ctx);
    expect(denied.status).toBe(401);
    const ok = await worker.fetch(new Request("http://localhost/v1/providers?key=alpha"), env, ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ fetch: { chain: ["cf_fetch"] } });
    const bad = await worker.fetch(new Request("http://localhost/v1/fetch?key=alpha&url=not-a-url"), env, ctx);
    expect(bad.status).toBe(400);
    const priv = await worker.fetch(
      new Request("http://localhost/v1/fetch", { method: "POST", headers: { "X-API-Key": "alpha" }, body: JSON.stringify({ url: "http://127.0.0.1/" }) }),
      env,
      ctx,
    );
    expect(priv.status).toBe(400);
    expect(((await priv.json()) as { error: string }).error).toMatch(/private/);
  });
});

describe("text helpers", () => {
  it("paginates", () => {
    expect(paginate("abcdef", 2, 3)).toEqual({ chunk: "cde", total: 6, end: 5, hasMore: true });
  });
  it("greps with merged context and caps", () => {
    const lines = ["a", "foo 1", "b", "foo 2", "c", "d", "e", "foo 3"];
    const r = grepLines(lines, "FOO", 1, 2);
    expect(r.matches).toBe(2);
    expect(r.capped).toBe(true);
    expect(r.output).toBe(["  1: a", "> 2: foo 1", "  3: b", "> 4: foo 2", "  5: c"].join("\n"));
  });
  it("rejects bad patterns", () => {
    expect(() => grepLines([], "(", 0, 1)).toThrow(/invalid regex/);
  });
});
