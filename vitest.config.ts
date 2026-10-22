import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sdk = (path: string) => fileURLToPath(new URL(`./packages/mcpy/src/${path}`, import.meta.url));

// Tests run against SDK sources, not dist, so they never see a stale build.
// Longest specifiers first: aliases match by prefix.
const alias = [
  { find: /^mcpy\/providers$/, replacement: sdk("providers/index.ts") },
  { find: /^mcpy\/telemetry$/, replacement: sdk("telemetry/index.ts") },
  { find: /^mcpy\/client$/, replacement: sdk("client.ts") },
  { find: /^mcpy\/mcp$/, replacement: sdk("mcp.ts") },
  { find: /^mcpy$/, replacement: sdk("index.ts") },
];

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: [
            "packages/mcpy/test/{unit,contract,regression,structure,perf}/**/*.test.ts",
            "apps/server/test/unit/**/*.test.ts",
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "e2e",
          include: ["apps/server/test/e2e/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          // One local Worker for the whole suite.
          fileParallelism: false,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "live",
          include: ["packages/mcpy/test/live/**/*.test.ts"],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
