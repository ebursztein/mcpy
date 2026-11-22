import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaAlertKind, RestRoute, type KvLike, type QuotaAlert } from "mcpy";
import { Pager, PUSHOVER_MESSAGES_URL, PushPriority } from "../../src/alerts.js";
import { crossed, dailySpendLimit, type CapWatch } from "../../src/budget.js";
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
  it("only the add that reaches a line counts as crossing it", () => {
    expect(crossed(0.07, 0.09, 0.1)).toBe(false);
    expect(crossed(0.09, 0.1, 0.1)).toBe(true);
    // 0.12 - 0.02 is 0.0999…: subtracting the add back would fire twice.
    expect(crossed(0.1, 0.12, 0.1)).toBe(false);
  });

  /** Records which line each add crossed. */
  function watched(warnAt: number) {
    const events: [string, number][] = [];
    const watch: CapWatch = {
      warnAt,
      onCapNear: async (spent) => void events.push(["near", spent]),
      onCapReached: async (spent) => void events.push(["reached", spent]),
    };
    return { events, watch };
  }

  it("warns once on passing the warning line, then once at the cap, each day", async () => {
    const ns = budgetNamespace();
    let now = new Date("2026-11-06T10:00:00Z");
    const { events, watch } = watched(0.8);
    const limit = dailySpendLimit(ns, "deepmine", 0.01, () => now, watch);
    for (let i = 0; i < 6; i++) await limit.record(0.002);
    expect(events.map(([kind]) => kind)).toEqual(["near", "reached"]);
    expect(events[0][1]).toBeCloseTo(0.008, 10);
    expect(events[1][1]).toBeCloseTo(0.01, 10);
    now = new Date("2026-11-07T10:00:00Z");
    for (let i = 0; i < 6; i++) await limit.record(0.002);
    expect(events.map(([kind]) => kind)).toEqual(["near", "reached", "near", "reached"]);
  });

  it("an add that jumps both lines reports only the cap", async () => {
    const { events, watch } = watched(0.8);
    const limit = dailySpendLimit(budgetNamespace(), "deepmine", 0.01, () => new Date("2026-11-06T10:00:00Z"), watch);
    await limit.record(0.005);
    await limit.record(0.006);
    expect(events.map(([kind]) => kind)).toEqual(["reached"]);
  });

  it("a warning at 100% is the cap alert alone", async () => {
    const { events, watch } = watched(1);
    const limit = dailySpendLimit(budgetNamespace(), "deepmine", 0.01, () => new Date("2026-11-06T10:00:00Z"), watch);
    for (let i = 0; i < 6; i++) await limit.record(0.002);
    expect(events.map(([kind]) => kind)).toEqual(["reached"]);
  });

  it("the running-low push says how much of the cap is used", async () => {
    const { posts, fetch } = pushover();
    await new Pager({ keys: KEYS, cooldownSeconds: 60, fetch }).capNear("deepmine", 10, 8.03);
    expect(posts[0].body).toMatchObject({ title: "mcpy: deepmine is running low on its daily cap", priority: PushPriority.Normal });
    expect(String(posts[0].body.message)).toContain("~$8.03 of its $10.00 cap today (80%)");
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

  it("warns a capped client is running low, then that it hit its cap", async () => {
    // At $0.001 a credit each failed Firecrawl search still costs its $0.002 estimate: 0.004 is 80% of 0.005.
    const e = env({ BUDGET: budgetNamespace(), DAILY_BUDGET_USD: "0.005", FIRECRAWL_USD_PER_CREDIT: "0.001" });
    for (const q of ["a", "b", "c"]) await call(`${RestRoute.Search}?query=${q}&max_age=0`, { env: e });
    expect(pushes.map((p) => p.title)).toEqual([
      "mcpy: firecrawl is out of credits",
      "mcpy: alice is running low on its daily cap",
      "mcpy: alice reached its daily cap",
    ]);
  });

  it("stays silent without Pushover keys", async () => {
    await call(`${RestRoute.Search}?query=quiet&max_age=0`, { env: env({ PUSHOVER_TOKEN: "", PUSHOVER_USER: "" }) });
    expect(pushes).toHaveLength(0);
  });
});
