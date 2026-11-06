import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaAlertKind, RestRoute, type KvLike, type QuotaAlert } from "mcpy";
import { Pager, PUSHOVER_MESSAGES_URL, PushPriority } from "../../src/alerts.js";
import { crossedCap, dailySpendLimit } from "../../src/budget.js";
import { budgetNamespace, call, makeEnv, stubNetwork } from "./harness.js";

const KEYS = { token: "app-token", user: "user-key" };
const OUT: QuotaAlert = { kind: QuotaAlertKind.OutOfCredits, provider: "firecrawl", status: 402 };

/** In-memory KV with the two calls the pager uses. */
function memoryKv(): KvLike {
  const data = new Map<string, string>();
  return { get: async (k) => (data.has(k) ? JSON.parse(data.get(k)!) : null), put: async (k, v) => void data.set(k, v) };
}

/** Records Pushover posts; answers like Pushover does. */
function pushover(answer: () => Response = () => Response.json({ status: 1, request: "r" })) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return answer();
  }) as unknown as typeof globalThis.fetch;
  return { posts, fetch };
}

describe("Pager", () => {
  it("sends one push per provider and kind per cooldown, across isolates sharing KV", async () => {
    const { posts, fetch } = pushover();
    const store = memoryKv();
    let now = 1_000_000;
    const a = new Pager({ keys: KEYS, store, cooldownSeconds: 3_600, fetch, now: () => now });
    const b = new Pager({ keys: KEYS, store, cooldownSeconds: 3_600, fetch, now: () => now });
    await a.quota(OUT, "deepmine");
    await a.quota(OUT, "deepmine");
    await b.quota(OUT, "cardy");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(PUSHOVER_MESSAGES_URL);
    expect(posts[0].body).toMatchObject({ token: "app-token", user: "user-key", priority: PushPriority.High, title: "mcpy: firecrawl is out of credits" });
    expect(String(posts[0].body.message)).toContain("HTTP 402 on a call for deepmine");

    // Another kind or provider is its own alert; after the cooldown the same one pages again.
    await a.quota({ ...OUT, kind: QuotaAlertKind.RateLimited, status: 429 }, "deepmine");
    expect(posts[1].body.priority).toBe(PushPriority.Normal);
    now += 3_600_001;
    await b.quota(OUT, "deepmine");
    expect(posts).toHaveLength(3);
  });

  it("throws when Pushover refuses, with its answer", async () => {
    const { fetch } = pushover(() => Response.json({ status: 0, errors: ["user key is invalid"] }, { status: 400 }));
    await expect(new Pager({ keys: KEYS, cooldownSeconds: 60, fetch }).capReached("cardy", 0.1, 0.1)).rejects.toThrow(/user key is invalid/);
  });
});

describe("cap alerts", () => {
  it("only the add that reaches the cap counts as crossing it", () => {
    expect(crossedCap(0.07, 0.09, 0.1)).toBe(false);
    expect(crossedCap(0.09, 0.1, 0.1)).toBe(true);
    // 0.12 - 0.02 is 0.0999…: subtracting the add back would fire twice.
    expect(crossedCap(0.1, 0.12, 0.1)).toBe(false);
  });

  it("fires once per client per day, on the crossing add", async () => {
    const ns = budgetNamespace();
    let now = new Date("2026-11-06T10:00:00Z");
    const crossings: number[] = [];
    const limit = dailySpendLimit(ns, "cardy", 0.01, () => now, async (spent) => void crossings.push(spent));
    for (let i = 0; i < 5; i++) await limit.record(0.004);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toBeCloseTo(0.012, 10);
    now = new Date("2026-11-07T10:00:00Z");
    for (let i = 0; i < 3; i++) await limit.record(0.004);
    expect(crossings).toHaveLength(2);
  });
});

describe("worker alerts", () => {
  let pushes: Record<string, unknown>[];
  beforeEach(() => {
    pushes = [];
    const { fetchStub } = stubNetwork();
    const network = fetchStub.getMockImplementation()!;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === PUSHOVER_MESSAGES_URL) {
        pushes.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ status: 1 });
      }
      if (new URL(url).hostname === "api.firecrawl.dev") return Response.json({ success: false, error: "Insufficient credits" }, { status: 402 });
      return network(input, init);
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const env = (vars: Record<string, unknown> = {}) =>
    makeEnv({ FIRECRAWL_API_KEY: "fc-test", PUSHOVER_TOKEN: "app-token", PUSHOVER_USER: "user-key", CACHE: memoryKv(), ...vars });

  it("pages once when the paid search source is out of credits", async () => {
    const e = env();
    expect((await call(`${RestRoute.Search}?query=one&max_age=0`, { env: e })).status).toBe(502);
    expect((await call(`${RestRoute.Search}?query=two&max_age=0`, { env: e })).status).toBe(502);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ title: "mcpy: firecrawl is out of credits", priority: PushPriority.High });
  });

  it("stays silent without Pushover keys", async () => {
    await call(`${RestRoute.Search}?query=quiet&max_age=0`, { env: env({ PUSHOVER_TOKEN: "", PUSHOVER_USER: "" }) });
    expect(pushes).toHaveLength(0);
  });
});
