import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheInspectionSchema, ErrorBodySchema, ErrorCode, RestRoute } from "mcpy";
import { ADMIN_KEY, articleUrl, call, makeEnv, stubNetwork } from "./harness.js";

beforeEach(() => void stubNetwork());
afterEach(() => vi.unstubAllGlobals());

/** A KV namespace in memory that remembers the keys written. */
function fakeKv() {
  const data = new Map<string, string>();
  return {
    data,
    get: async (keys: string[] | string, type: "json" | "text"): Promise<never> => {
      const one = (k: string) => (!data.has(k) ? null : type === "json" ? JSON.parse(data.get(k)!) : data.get(k)!);
      return (typeof keys === "string" ? one(keys) : new Map(keys.map((k) => [k, one(k)]))) as never;
    },
    put: async (key: string, value: string) => void data.set(key, value),
  };
}

describe("GET /v1/admin/cache", () => {
  it("shows an admin the entry a fetch stored, by the key its logs name", async () => {
    const kv = fakeKv();
    const env = makeEnv({ CACHE: kv });
    expect((await call(`${RestRoute.Fetch}?url=${encodeURIComponent(articleUrl("cached"))}`, { env })).status).toBe(200);
    const key = [...kv.data.keys()].find((k) => k.startsWith("v2:page:"));
    expect(key).toBeDefined();

    const res = await call(`/v1/admin/cache?cache_key=${encodeURIComponent(key!)}`, { env, key: ADMIN_KEY });
    expect(res.status).toBe(200);
    const entry = CacheInspectionSchema.parse(await res.json());
    expect(entry).toMatchObject({ key, name: "page", version: 2, current: true, found: true, envelope: true, provider: "direct", truncated: false });
    expect(entry.value_json).toContain("Gardens of the Northern Coast");
  });

  it("reports a key that holds nothing as not found", async () => {
    const env = makeEnv({ CACHE: fakeKv() });
    const res = await call(`/v1/admin/cache?cache_key=${encodeURIComponent("v1:route:markdown:nowhere.example")}`, { env, key: ADMIN_KEY });
    expect(CacheInspectionSchema.parse(await res.json())).toMatchObject({ name: "route", current: true, found: false });
  });

  it("needs cache_key, and is for admins only", async () => {
    const env = makeEnv({ CACHE: fakeKv() });
    const missing = await call("/v1/admin/cache", { env, key: ADMIN_KEY });
    expect(ErrorBodySchema.parse(await missing.json()).error.code).toBe(ErrorCode.InvalidInput);
    const user = await call("/v1/admin/cache?cache_key=v2%3Apage%3Ax", { env });
    expect(user.status).toBe(403);
  });
});
