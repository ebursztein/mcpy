import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBodySchema, ErrorCode, RestRoute } from "mcpy";
import { call, stubNetwork } from "./harness.js";

beforeEach(() => void stubNetwork());
afterEach(() => vi.unstubAllGlobals());

const errorOf = async (res: Response) => ErrorBodySchema.parse(await res.json()).error;

describe("GET /v1/search with friendly query parameters", () => {
  it("parses comma-separated site lists into arrays", async () => {
    // Both lists given: rejected by validation, which proves both were parsed as lists.
    const res = await call(`${RestRoute.Search}?query=rust&sites=a.com,b.org&exclude_sites=c.com`);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).details?.join(" ")).toMatch(/sites or exclude_sites/);
  });

  it("validates every friendly field", async () => {
    for (const bad of ["type=podcasts", "recency=decade", "country=usa", "device=watch", "mode=slow", "page=0", "max_results=500"]) {
      const res = await call(`${RestRoute.Search}?query=rust&${bad}`);
      expect(res.status, bad).toBe(400);
      expect((await errorOf(res)).code, bad).toBe(ErrorCode.InvalidInput);
    }
  });

  it("accepts a fully specified search (and reports that no source is configured)", async () => {
    const res = await call(`${RestRoute.Search}?query=rust&type=news&recency=week&country=US&language=en&sites=github.com,lwn.net&page=2&max_results=5&mode=thorough`);
    expect((await errorOf(res)).code).toBe(ErrorCode.NoProviders);
  });
});
