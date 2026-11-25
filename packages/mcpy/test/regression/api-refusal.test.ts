/**
 * Regression (2026-11-25, production): Kryptex's pool API answers 403 {"detail":"You do not
 * have permission to perform this action."} for a worker chart closed to the account. mcpy took
 * every 403 for a bot wall, tried three paid sources that got the same 403, and answered 502
 * upstream_failed. deepmine retried each 502 twice, every run, for three coins, until its daily
 * budget was spent. An API's own JSON refusal is now the answer: status 403 and its body, from
 * the first source, cached like a 404. Bot walls that answer in JSON still escalate.
 */

import { describe, expect, it } from "vitest";
import { ContentKind } from "mcpy";
import { assessPage } from "../../src/engine/quality.js";
import { fakePages, page, testMcpy } from "../helpers.js";

const URL = "https://pool.kryptex.com/xmr/api/v1/miner/chart/krxX6D479K/ff";
const refusal = (status: number, content: string) => page({ url: URL, finalUrl: URL, status, contentType: "application/json", kind: ContentKind.Json, content });
const KRYPTEX = '{"detail":"You do not have permission to perform this action."}';

describe("an API's own refusal", () => {
  it("returns Kryptex's 403 and its body without paying another source", async () => {
    const direct = fakePages("direct", refusal(403, KRYPTEX));
    const paid = fakePages("paid", refusal(403, KRYPTEX), 0.0058);
    const { mcpy } = testMcpy({ pages: [direct, paid] });
    const r = await mcpy.fetch({ url: URL });
    expect(r).toMatchObject({ status: 403, content: KRYPTEX });
    expect(paid.calls).toHaveLength(0);
  });

  it("treats a 401 the same way", () => {
    expect(assessPage(refusal(401, '{"error":"invalid token"}')).outcome).toBe("final");
  });

  it("still escalates bot walls, JSON or not", () => {
    const walls = [
      refusal(403, '{"title":"Error 1020: Access denied","status":403,"cloudflare_error":true,"ray_id":"8f1"}'),
      refusal(403, '{"url":"https://geo.captcha-delivery.com/captcha/?initialCid=x"}'),
      refusal(403, "error code: 1020"), // not JSON
      refusal(403, `{"detail":"${"x".repeat(3_000)}"}`), // too big to be a short refusal
      page({ status: 403, content: "<html><title>Just a moment...</title></html>" }),
    ];
    for (const wall of walls) expect(assessPage(wall).outcome, wall.content.slice(0, 40)).toBe("escalate");
    expect(assessPage(refusal(500, KRYPTEX)).outcome).toBe("escalate");
  });
});
