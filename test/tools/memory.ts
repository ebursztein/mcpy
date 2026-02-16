/**
 * Tests for the memory tool.
 */
import { suite, assert } from "../lib/harness.ts";
import { call } from "../lib/mcp.ts";

export async function testMemory() {
  suite("memory");

  // start clean -- delete any leftover keys
  await call("memory", { action: "delete", key: "test_key" });
  await call("memory", { action: "delete", key: "search_a" });
  await call("memory", { action: "delete", key: "search_b" });

  // set
  const setRes = await call("memory", { action: "set", key: "test_key", value: "hello world" });
  assert("set returns confirmation", setRes.includes("Stored"));
  assert("set echoes key", setRes.includes("test_key"));

  // get
  const getRes = await call("memory", { action: "get", key: "test_key" });
  assert("get returns value", getRes.includes("hello world"));

  // get missing key
  const missingRes = await call("memory", { action: "get", key: "nonexistent_key_xyz" });
  assert("get missing key returns not found", missingRes.includes("No memory found"));

  // overwrite
  await call("memory", { action: "set", key: "test_key", value: "updated value" });
  const getUpdated = await call("memory", { action: "get", key: "test_key" });
  assert("overwrite updates value", getUpdated.includes("updated value"));

  // list
  const listRes = await call("memory", { action: "list" });
  assert("list includes key", listRes.includes("test_key"));

  // search
  await call("memory", { action: "set", key: "search_a", value: "alpha data" });
  await call("memory", { action: "set", key: "search_b", value: "beta data" });

  const searchRes = await call("memory", { action: "search", query: "alpha" });
  assert("search finds matching entry", searchRes.includes("search_a"));
  assert("search returns result count", searchRes.includes("result"));

  const searchMiss = await call("memory", { action: "search", query: "zzz_no_match_zzz" });
  assert("search miss returns no matches", searchMiss.includes("No memories matching"));

  // delete
  const delRes = await call("memory", { action: "delete", key: "test_key" });
  assert("delete returns confirmation", delRes.includes("Deleted"));

  // verify deleted
  const afterDel = await call("memory", { action: "get", key: "test_key" });
  assert("deleted key returns not found", afterDel.includes("No memory found"));

  // cleanup
  await call("memory", { action: "delete", key: "search_a" });
  await call("memory", { action: "delete", key: "search_b" });
}
