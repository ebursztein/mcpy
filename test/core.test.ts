import { describe, expect, it } from "vitest";
import { MemoryCache } from "../src/core/cache";
import { ChainExhaustedError, fetchWithFallback } from "../src/core/chain";
import { assessPage } from "../src/core/quality";
import { WebService } from "../src/core/service";
import { MemoryTelemetry } from "../src/core/telemetry";
import { loadConfig } from "../src/config";
import { fakeFetcher, page } from "./helpers";

const req = { url: "https://example.com/a", format: "markdown" as const, timeoutMs: 1000 };

describe("assessPage", () => {
  it("accepts a normal page", () => expect(assessPage(page()).kind).toBe("ok"));
  it("treats 404 as final", () => expect(assessPage(page({ status: 404 })).kind).toBe("final"));
  it("escalates on 403", () => expect(assessPage(page({ status: 403 })).kind).toBe("escalate"));
  it("escalates on a Cloudflare challenge", () => {
    const html = `<html><head><title>Just a moment...</title></head><body>${"x".repeat(500)}</body></html>`;
    expect(assessPage(page({ content: html })).kind).toBe("escalate");
  });
  it("escalates on near-empty content", () => expect(assessPage(page({ content: "Loading..." })).kind).toBe("escalate"));
});

describe("fetchWithFallback", () => {
  it("stops at the first usable page", async () => {
    const a = fakeFetcher("a", page());
    const b = fakeFetcher("b", page());
    const r = await fetchWithFallback([a, b], req, { tool: "t", target: "x", telemetry: new MemoryTelemetry() });
    expect(r.provider).toBe("a");
    expect(b.calls).toBe(0);
  });

  it("escalates past errors and blocked pages, summing cost", async () => {
    const a = fakeFetcher("a", new Error("boom"));
    const b = fakeFetcher("b", page({ status: 403 }), 0.001);
    const c = fakeFetcher("c", page(), 0.002);
    const tel = new MemoryTelemetry();
    const r = await fetchWithFallback([a, b, c], req, { tool: "t", target: "x", telemetry: tel });
    expect(r.provider).toBe("c");
    expect(r.attempts.map((x) => x.outcome)).toEqual(["error", "escalate", "ok"]);
    expect(r.costUsd).toBeCloseTo(0.003);
    expect(tel.events).toHaveLength(3);
  });

  it("does not pay for a fallback after a definitive 404", async () => {
    const a = fakeFetcher("a", page({ status: 404 }));
    const b = fakeFetcher("b", page());
    const r = await fetchWithFallback([a, b], req, { tool: "t", target: "x", telemetry: new MemoryTelemetry() });
    expect(r.value.status).toBe(404);
    expect(b.calls).toBe(0);
  });

  it("reports every attempt when all fail", async () => {
    const err = await fetchWithFallback([fakeFetcher("a", new Error("nope"))], req, {
      tool: "t",
      target: "x",
      telemetry: new MemoryTelemetry(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ChainExhaustedError);
    expect(err.message).toContain("a (nope)");
  });

  it("explains an empty chain", async () => {
    const err = await fetchWithFallback([], req, { tool: "t", target: "x", telemetry: new MemoryTelemetry() }).catch((e) => e);
    expect(err.message).toContain("no providers");
  });
});

describe("WebService", () => {
  const config = loadConfig({});
  const make = (fetchers: ReturnType<typeof fakeFetcher>[]) => {
    const tel = new MemoryTelemetry();
    const svc = new WebService(config, { chain: fetchers, skipped: [] }, { chain: [], skipped: [] }, new MemoryCache(), tel);
    return { svc, tel };
  };

  it("serves the second call from cache", async () => {
    const a = fakeFetcher("a", page());
    const { svc, tel } = make([a]);
    const first = await svc.fetchPage("web_fetch", "https://example.com/a#frag", { format: "markdown" });
    const second = await svc.fetchPage("web_fetch", "https://example.com/a", { format: "markdown" });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.provider).toBe("a");
    expect(a.calls).toBe(1);
    expect(tel.events.filter((e) => e.event === "call").map((e) => e.outcome)).toEqual(["ok", "hit"]);
  });

  it("bypasses the cache with fresh", async () => {
    const a = fakeFetcher("a", page());
    const { svc } = make([a]);
    await svc.fetchPage("web_fetch", "https://example.com/a", { format: "markdown" });
    await svc.fetchPage("web_fetch", "https://example.com/a", { format: "markdown", fresh: true });
    expect(a.calls).toBe(2);
  });

  it("forces a single provider", async () => {
    const a = fakeFetcher("a", page());
    const b = fakeFetcher("b", page());
    const { svc } = make([a, b]);
    const r = await svc.fetchPage("web_fetch", "https://example.com/a", { format: "markdown", provider: "b" });
    expect(r.provider).toBe("b");
    expect(a.calls).toBe(0);
    await expect(svc.fetchPage("web_fetch", "https://example.com/a", { format: "markdown", provider: "zzz" })).rejects.toThrow(/not enabled/);
  });

  it("refuses private hosts before calling any provider", async () => {
    const a = fakeFetcher("a", page());
    const { svc } = make([a]);
    for (const url of ["http://localhost/x", "http://127.0.0.1/", "http://10.1.2.3/", "file:///etc/passwd", "http://u:p@example.com/"]) {
      await expect(svc.fetchPage("web_fetch", url, { format: "markdown" })).rejects.toThrow();
    }
    expect(a.calls).toBe(0);
  });
});
