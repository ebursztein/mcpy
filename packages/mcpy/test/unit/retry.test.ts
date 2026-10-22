import { describe, expect, it } from "vitest";
import { backoffDelay, isRetryableError, isRetryableStatus, retryAfterMs, sleep, type RetryPolicy } from "../../src/http/retry.js";

const policy: RetryPolicy = { retries: 3, baseDelayMs: 100, maxDelayMs: 1_000 };

describe("backoffDelay", () => {
  it("is zero when the jitter draws zero", () => {
    expect(backoffDelay(1, policy, () => 0)).toBe(0);
    expect(backoffDelay(4, policy, () => 0)).toBe(0);
  });

  it("doubles the ceiling with each attempt (full jitter, top of range)", () => {
    const top = () => 1;
    expect(backoffDelay(1, policy, top)).toBe(100);
    expect(backoffDelay(2, policy, top)).toBe(200);
    expect(backoffDelay(3, policy, top)).toBe(400);
    expect(backoffDelay(4, policy, top)).toBe(800);
  });

  it("is capped at maxDelayMs however many attempts were made", () => {
    expect(backoffDelay(5, policy, () => 1)).toBe(1_000);
    expect(backoffDelay(30, policy, () => 1)).toBe(1_000);
  });

  it("scales with the random draw and stays within [0, ceiling]", () => {
    expect(backoffDelay(2, policy, () => 0.5)).toBe(100);
    for (let attempt = 1; attempt <= 8; attempt++) {
      const d = backoffDelay(attempt, policy);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1)));
    }
  });

  it("is zero when the base delay is zero", () => {
    expect(backoffDelay(3, { retries: 2, baseDelayMs: 0, maxDelayMs: 1_000 }, () => 1)).toBe(0);
  });
});

describe("retryAfterMs", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");

  it("is undefined without a header", () => {
    expect(retryAfterMs(null, policy, now)).toBeUndefined();
    expect(retryAfterMs("", policy, now)).toBeUndefined();
  });

  it("reads delta-seconds", () => {
    expect(retryAfterMs("0", policy, now)).toBe(0);
    expect(retryAfterMs("0.5", policy, now)).toBe(500);
    expect(retryAfterMs("1", policy, now)).toBe(1_000);
  });

  it("reads an HTTP date relative to now", () => {
    expect(retryAfterMs("Thu, 22 Oct 2026 12:00:00 GMT", policy, now)).toBe(0);
    const inHalfASecond = new Date(now + 500).toUTCString(); // second precision: rounds down to now
    expect(retryAfterMs(inHalfASecond, policy, now)).toBe(0);
    expect(retryAfterMs(new Date(now + 2_000).toUTCString(), { ...policy, maxDelayMs: 60_000 }, now)).toBe(2_000);
  });

  it("is undefined for garbage, negative values and dates in the past", () => {
    expect(retryAfterMs("soon", policy, now)).toBeUndefined();
    expect(retryAfterMs("-5", policy, now)).toBeUndefined();
    expect(retryAfterMs("Wed, 21 Oct 2026 12:00:00 GMT", policy, now)).toBeUndefined();
  });

  it("is capped at maxDelayMs", () => {
    expect(retryAfterMs("3600", policy, now)).toBe(policy.maxDelayMs);
    expect(retryAfterMs("Fri, 23 Oct 2026 12:00:00 GMT", policy, now)).toBe(policy.maxDelayMs);
  });
});

describe("isRetryableStatus", () => {
  it.each([408, 425, 429, 500, 502, 503, 504])("retries HTTP %i", (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([200, 201, 301, 304, 400, 401, 403, 404, 410, 418, 422, 501, 505])("does not retry HTTP %i", (status) => {
    expect(isRetryableStatus(status)).toBe(false);
  });
});

function named(name: string, message = "x"): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("isRetryableError", () => {
  it.each([
    ["TypeError (undici fetch failure)", new TypeError("fetch failed")],
    ["network message", new Error("Network connection lost")],
    ["ECONNRESET", new Error("read ECONNRESET")],
    ["socket hang up", new Error("socket hang up")],
    ["DNS EAI_AGAIN", new Error("getaddrinfo EAI_AGAIN example.com")],
  ])("retries %s", (_label, err) => {
    expect(isRetryableError(err)).toBe(true);
  });

  it.each([
    ["AbortError", named("AbortError", "network aborted")],
    ["TimeoutError", named("TimeoutError", "fetch failed: timeout")],
    ["DOMException abort", new DOMException("aborted", "AbortError")],
    ["DOMException timeout", new DOMException("timed out", "TimeoutError")],
    ["plain Error", new Error("boom")],
    ["RangeError", new RangeError("bad")],
    ["string", "network error"],
    ["undefined", undefined],
  ])("does not retry %s", (_label, err) => {
    expect(isRetryableError(err)).toBe(false);
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    await expect(sleep(1, new AbortController().signal)).resolves.toBeUndefined();
  });

  it("rejects at once with the reason of an already-aborted signal", async () => {
    const ac = new AbortController();
    ac.abort(named("AbortError"));
    await expect(sleep(10_000, ac.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects when the signal aborts mid-sleep", async () => {
    const ac = new AbortController();
    const pending = sleep(10_000, ac.signal);
    ac.abort(named("TimeoutError"));
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
