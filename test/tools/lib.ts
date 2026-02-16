/**
 * Unit tests for shared tool libs: paginate, grep, cache.
 * These run in-process (no MCP needed).
 */
import { suite, assert } from "../lib/harness.ts";
import { paginate, paginationHeader } from "../../src/tools/lib/paginate.ts";
import { grepLines } from "../../src/tools/lib/grep.ts";
import { TtlCache } from "../../src/tools/lib/cache.ts";

export async function testLib() {
  suite("lib/paginate");

  // Basic paginate
  const r1 = paginate("hello world", 0, 100);
  assert("paginate full content", r1.chunk === "hello world");
  assert("paginate total correct", r1.total === 11);
  assert("paginate no more", r1.hasMore === false);

  // Paginate with offset
  const r2 = paginate("hello world", 6, 100);
  assert("paginate offset returns remainder", r2.chunk === "world");

  // Paginate with max_length cap
  const r3 = paginate("hello world", 0, 5);
  assert("paginate capped chunk", r3.chunk === "hello");
  assert("paginate has more when capped", r3.hasMore === true);
  assert("paginate total unchanged when capped", r3.total === 11);

  // Paginate second page
  const r4 = paginate("hello world", 5, 6);
  assert("paginate second page", r4.chunk === " world");
  assert("paginate second page no more", r4.hasMore === false);

  // Paginate empty string
  const r5 = paginate("", 0, 100);
  assert("paginate empty string", r5.chunk === "" && r5.total === 0 && !r5.hasMore);

  // Paginate past end
  const r6 = paginate("hello", 100, 50);
  assert("paginate past end returns empty", r6.chunk === "");
  assert("paginate past end no more", r6.hasMore === false);

  // paginationHeader
  const h = paginationHeader(0, "hello", 11, true, 5);
  assert("paginationHeader has total", h.includes("Total length: 11 chars"));
  assert("paginationHeader has showing", h.includes("Showing: 0-5"));
  assert("paginationHeader has more hint", h.includes("start_index=5"));

  suite("lib/grep");

  const lines = [
    "first line",
    "second line with target word",
    "third line",
    "fourth line",
    "fifth target line",
    "sixth line",
    "seventh line",
  ];

  // Basic grep
  const g1 = grepLines(lines, "target", 1, 10);
  assert("grep finds matches", g1.matches === 2);
  assert("grep not capped", g1.capped === false);
  assert("grep output has match marker", g1.output.includes(">>>"));
  assert("grep output has context lines", g1.output.includes("first line"));

  // Grep with 0 context
  const g2 = grepLines(lines, "target", 0, 10);
  assert("grep 0 context still has matches", g2.matches === 2);
  assert("grep 0 context no first line", !g2.output.includes("first line"));

  // Grep with max_matches cap
  const g3 = grepLines(lines, "target", 1, 1);
  assert("grep capped at 1", g3.matches === 1);
  assert("grep capped flag set", g3.capped === true);

  // Grep no matches
  const g4 = grepLines(lines, "nonexistent", 1, 10);
  assert("grep no matches returns 0", g4.matches === 0);
  assert("grep no matches empty output", g4.output === "");

  // Grep invalid regex throws
  let grepThrew = false;
  try {
    grepLines(lines, "[invalid", 1, 10);
  } catch (err) {
    grepThrew = true;
    assert("grep invalid regex error message", (err as Error).message.includes("Invalid regex"));
  }
  assert("grep invalid regex throws", grepThrew);

  // Grep case insensitive
  const g5 = grepLines(["Hello WORLD", "hello world"], "hello", 0, 10);
  assert("grep case insensitive matches both", g5.matches === 2);

  // Grep overlapping context merges
  const closeLines = ["a", "TARGET", "b", "TARGET", "c"];
  const g6 = grepLines(closeLines, "TARGET", 1, 10);
  assert("grep overlapping context merges correctly", g6.matches === 2);
  // Should not have duplicate line numbers
  const lineNums = [...g6.output.matchAll(/\d+ \|/g)].map(m => m[0]);
  const uniqueNums = new Set(lineNums);
  assert("grep no duplicate lines in output", lineNums.length === uniqueNums.size);

  // Grep line numbers are 1-based
  const g7 = grepLines(["match"], "match", 0, 10);
  assert("grep line numbers 1-based", g7.output.includes("   1 |"));

  suite("lib/cache");

  // Basic set/get
  const cache = new TtlCache(1000, 5);
  cache.set("key1", "value1");
  assert("cache get returns value", cache.get("key1") === "value1");

  // Missing key
  assert("cache get missing returns null", cache.get("missing") === null);

  // Overwrite
  cache.set("key1", "value2");
  assert("cache overwrite updates value", cache.get("key1") === "value2");

  // Max size eviction
  for (let i = 0; i < 6; i++) {
    cache.set(`fill_${i}`, `val_${i}`);
  }
  // Cache has max 5, so the earliest entries should be evicted
  assert("cache evicts oldest when full", cache.get("key1") === null);
  assert("cache keeps recent entries", cache.get("fill_5") === "val_5");

  // TTL expiry
  const shortCache = new TtlCache(1, 100); // 1ms TTL
  shortCache.set("expire", "soon");
  // Wait 10ms for the entry to expire
  await new Promise(r => setTimeout(r, 10));
  assert("cache expires after TTL", shortCache.get("expire") === null);
}
