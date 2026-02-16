/**
 * Shared test harness -- assertion helpers and result tracking.
 */

export const HTTP_PORT = parseInt(process.env.PORT || "3713", 10);
export const HTTP_BASE = `http://localhost:${HTTP_PORT}`;

export interface TestResult {
  name: string;
  ok: boolean;
  detail?: string;
}

let passed = 0;
let failed = 0;
const results: TestResult[] = [];
let currentSuite = "";

export function suite(name: string) {
  currentSuite = name;
  console.log(`[${name}]`);
}

export function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    results.push({ name: `${currentSuite}: ${name}`, ok: true });
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    results.push({ name: `${currentSuite}: ${name}`, ok: false, detail });
    console.error(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

export function summary(): { passed: number; failed: number; results: TestResult[] } {
  console.log("\n=== Results ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    console.log("\nFailed:");
    for (const r of results) {
      if (!r.ok) console.log(`  - ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
    }
  }
  console.log("");

  return { passed, failed, results };
}
