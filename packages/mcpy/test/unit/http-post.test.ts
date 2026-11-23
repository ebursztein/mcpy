/** The HTTP client with a caller's POST: what it sends, when it retries, how redirects end. */

import { describe, expect, it } from "vitest";
import { ErrorCode, LogLevel } from "mcpy";
import { Telemetry } from "mcpy/telemetry";
import { ProviderFailure } from "../../src/errors.js";
import { HttpClient, HttpMethod, type HttpContext } from "../../src/http/client.js";
import { responseAt, stubFetch } from "../helpers.js";

const TARGET = "https://api.example.com/search";
const POST = { url: TARGET, method: HttpMethod.Post, body: "q=charizard", headers: { "Content-Type": "application/x-www-form-urlencoded" } };

function setup(reply: Parameters<typeof stubFetch>[0]) {
  const { fetch, calls } = stubFetch(reply);
  const client = new HttpClient({ fetch, retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 2 } });
  const ctx: HttpContext = { signal: new AbortController().signal, deadlineAt: Date.now() + 10_000, maxBytes: 100_000, telemetry: new Telemetry([], {}, LogLevel.Warn) };
  return { client, ctx, calls };
}

describe("HttpClient with a caller's POST", () => {
  it("sends the body as given", async () => {
    const { client, ctx, calls } = setup((url) => responseAt(url, "ok"));
    await client.send(POST, ctx);
    expect(calls[0]).toMatchObject({ method: "POST", body: "q=charizard" });
    expect(calls[0].headers.get("content-type")).toBe("application/x-www-form-urlencoded");
  });

  it("never sends it twice after a 5xx or a lost connection: the server may have acted on it", async () => {
    const failing = setup((url) => responseAt(url, "oops", { status: 502 }));
    expect((await failing.client.send(POST, failing.ctx)).status).toBe(502);
    expect(failing.calls).toHaveLength(1);

    const dropped = setup(() => {
      throw new TypeError("fetch failed");
    });
    const err = await dropped.client.send(POST, dropped.ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderFailure);
    expect((err as ProviderFailure).code).toBe(ErrorCode.UpstreamFailed);
    expect(dropped.calls).toHaveLength(1);
  });

  it("sends it again when the answer says it was not processed (429)", async () => {
    const { client, ctx, calls } = setup((url, n) => (n === 1 ? responseAt(url, "slow down", { status: 429 }) : responseAt(url, "ok")));
    expect((await client.send(POST, ctx)).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("follows a 303 as a GET without the body or its content type", async () => {
    const { client, ctx, calls } = setup((url, n) => (n === 1 ? responseAt(url, null, { status: 303, headers: { location: "/results/1" } }) : responseAt(url, "done")));
    const res = await client.send(POST, ctx);
    expect(res.url).toBe("https://api.example.com/results/1");
    expect(calls[1].method).toBe("GET");
    expect(calls[1].body).toBeUndefined();
    expect(calls[1].headers.get("content-type")).toBeNull();
  });

  it("keeps the POST through a 307", async () => {
    const { client, ctx, calls } = setup((url, n) => (n === 1 ? responseAt(url, null, { status: 307, headers: { location: "/v2/search" } }) : responseAt(url, "done")));
    await client.send(POST, ctx);
    expect(calls[1]).toMatchObject({ method: "POST", body: "q=charizard" });
  });
});
