import { ErrorCode, McpyError } from "mcpy";
import { describe, expect, it } from "vitest";
import { ClientRole, extractKey, findClient, parseClients, stripUrlKey } from "../../src/clients.js";

const KEY_A = "a".repeat(24);
const KEY_B = "b".repeat(32);
const KEY_C = "c-0123456789abcdefghijklm";

function parseError(raw: string): McpyError {
  try {
    parseClients(raw);
  } catch (err) {
    expect(err).toBeInstanceOf(McpyError);
    return err as McpyError;
  }
  throw new Error("expected parseClients to throw");
}

describe("parseClients", () => {
  it("parses name:key[:role] entries, defaulting the role to user", () => {
    const clients = parseClients(` alice:${KEY_A} , ops-bot:${KEY_B}:admin,carol_2:${KEY_C}:user `);
    expect(clients).toEqual([
      { name: "alice", key: KEY_A, role: ClientRole.User },
      { name: "ops-bot", key: KEY_B, role: ClientRole.Admin },
      { name: "carol_2", key: KEY_C, role: ClientRole.User },
    ]);
  });

  it("returns no clients for an unset or empty var", () => {
    expect(parseClients(undefined)).toEqual([]);
    expect(parseClients("")).toEqual([]);
    expect(parseClients(" , ")).toEqual([]);
  });

  it("treats an empty role as the default", () => {
    expect(parseClients(`alice:${KEY_A}:`)[0].role).toBe(ClientRole.User);
  });

  it("rejects keys shorter than 24 characters", () => {
    const err = parseError(`alice:${"x".repeat(23)}`);
    expect(err.code).toBe(ErrorCode.Internal);
    expect(err.message).toContain("entry 1");
    expect(err.details?.join(" ")).toContain("24");
  });

  it("rejects an entry without a key", () => {
    expect(parseError("alice").code).toBe(ErrorCode.Internal);
  });

  it.each(["Alice", "-alice", "al ice", "al.ice", "x".repeat(64), ""])("rejects the client name %j", (name) => {
    expect(parseError(`ok:${KEY_B},${name}:${KEY_A}`).message).toContain("entry 2");
  });

  it("rejects duplicate names", () => {
    expect(parseError(`alice:${KEY_A},alice:${KEY_B}`).message).toContain("duplicate");
  });

  it("rejects an unknown role", () => {
    expect(parseError(`alice:${KEY_A}:root`).code).toBe(ErrorCode.Internal);
  });

  it("never echoes the key in the error", () => {
    const err = parseError(`Alice:${KEY_A}`);
    expect(JSON.stringify(err.toJSON())).not.toContain(KEY_A);
  });
});

describe("extractKey", () => {
  const at = (path: string, headers: Record<string, string> = {}) => {
    const request = new Request(`https://mcpy.test${path}`, { headers });
    return extractKey(request, new URL(request.url));
  };

  it("reads each location", () => {
    expect(at("/v1/fetch", { Authorization: `Bearer ${KEY_A}` })).toBe(KEY_A);
    expect(at("/v1/fetch", { Authorization: `bearer   ${KEY_A}` })).toBe(KEY_A);
    expect(at("/v1/fetch", { "X-API-Key": ` ${KEY_B} ` })).toBe(KEY_B);
    expect(at(`/v1/fetch?key=${KEY_C}`)).toBe(KEY_C);
  });

  it("prefers Bearer over X-API-Key over ?key=", () => {
    expect(at(`/x?key=${KEY_C}`, { Authorization: `Bearer ${KEY_A}`, "X-API-Key": KEY_B })).toBe(KEY_A);
    expect(at(`/x?key=${KEY_C}`, { "X-API-Key": KEY_B })).toBe(KEY_B);
  });

  it("falls through a non-Bearer or empty Authorization header", () => {
    expect(at("/x", { Authorization: `Basic ${KEY_A}`, "X-API-Key": KEY_B })).toBe(KEY_B);
    expect(at(`/x?key=${KEY_C}`, { Authorization: "Bearer " })).toBe(KEY_C);
  });

  it("returns undefined when no key is present", () => {
    expect(at("/x")).toBeUndefined();
    expect(at("/x?key=", { "X-API-Key": "  " })).toBeUndefined();
  });
});

describe("stripUrlKey", () => {
  it("removes only the key parameter and keeps method and headers", () => {
    const original = new Request(`https://mcpy.test/mcp?a=1&key=${KEY_A}&b=2`, { headers: { "X-Trace": "t" } });
    const clean = stripUrlKey(original, new URL(original.url));
    const url = new URL(clean.url);
    expect(url.searchParams.has("key")).toBe(false);
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.searchParams.get("b")).toBe("2");
    expect(url.pathname).toBe("/mcp");
    expect(clean.method).toBe("GET");
    expect(clean.headers.get("X-Trace")).toBe("t");
  });

  it("returns the same request when there is no key", () => {
    const original = new Request("https://mcpy.test/mcp?a=1");
    expect(stripUrlKey(original, new URL(original.url))).toBe(original);
  });
});

describe("findClient", () => {
  const clients = parseClients(`alice:${KEY_A},bob:${KEY_B}:admin,carol:${KEY_C}`);

  it("returns the client owning each key", async () => {
    expect((await findClient(clients, KEY_A))?.name).toBe("alice");
    expect((await findClient(clients, KEY_B))?.name).toBe("bob");
    expect((await findClient(clients, KEY_B))?.role).toBe(ClientRole.Admin);
    expect((await findClient(clients, KEY_C))?.name).toBe("carol");
  });

  it("returns undefined for wrong, partial or missing keys", async () => {
    expect(await findClient(clients, "z".repeat(24))).toBeUndefined();
    expect(await findClient(clients, KEY_A.slice(1))).toBeUndefined();
    expect(await findClient(clients, `${KEY_A}x`)).toBeUndefined();
    expect(await findClient(clients, undefined)).toBeUndefined();
    expect(await findClient(clients, "")).toBeUndefined();
    expect(await findClient([], KEY_A)).toBeUndefined();
  });
});
