/**
 * Architecture rules from docs/ARCHITECTURE.md, enforced on the source tree.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FetchInputSchema, FetchResultSchema, GrepInputSchema, GrepResultSchema, SearchInputSchema, SearchResultSchema } from "mcpy";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SDK_SRC = join(ROOT, "packages/mcpy/src");
const SERVER_SRC = join(ROOT, "apps/server/src");
const MAX_LINES = 300;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const sdkFiles = walk(SDK_SRC);
const serverFiles = walk(SERVER_SRC);
const testFiles = [...walk(join(ROOT, "packages/mcpy/test")), ...walk(join(ROOT, "apps/server/test"))];
const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => relative(ROOT, path);

describe("module size", () => {
  it.each([...sdkFiles, ...serverFiles, ...testFiles].map((f) => [rel(f), f]))(`%s stays under ${MAX_LINES} lines`, (_name, file) => {
    expect(read(file).split("\n").length).toBeLessThanOrEqual(MAX_LINES);
  });
});

describe("layering", () => {
  it("the server only imports public SDK entry points", () => {
    const allowed = new Set(["mcpy", "mcpy/providers", "mcpy/telemetry", "mcpy/mcp", "mcpy/client"]);
    for (const file of serverFiles) {
      for (const [, spec] of read(file).matchAll(/from\s+"([^"]+)"/g)) {
        if (spec.startsWith("mcpy") || spec.includes("packages/mcpy")) expect(allowed, `${rel(file)} imports ${spec}`).toContain(spec);
      }
    }
  });

  it("the MCP adapter and REST client depend on the public API only", () => {
    for (const name of ["mcp.ts", "client.ts"]) {
      const source = read(join(SDK_SRC, name));
      expect(source, name).not.toMatch(/from "\.\/(engine|providers|http)\//);
    }
  });

  it("providers reach the network only through HttpClient", () => {
    for (const file of sdkFiles.filter((f) => f.includes("/providers/"))) {
      // `fetch(` not preceded by `.` or a word char: a direct global fetch call.
      expect(read(file), rel(file)).not.toMatch(/(^|[^.\w])fetch\s*\(/m);
    }
  });

  it("each built-in provider lives in its own folder with an index", () => {
    const dirs = readdirSync(join(SDK_SRC, "providers")).filter((d) => statSync(join(SDK_SRC, "providers", d)).isDirectory());
    expect(dirs.sort()).toEqual(["brightdata", "cloudflare-browser", "direct", "firecrawl"]);
    for (const d of dirs) expect(statSync(join(SDK_SRC, "providers", d, "index.ts")).isFile()).toBe(true);
  });

  it("the Worker entry module exports only its default handler", () => {
    const source = read(join(SERVER_SRC, "index.ts"));
    const named = [...source.matchAll(/^export\s+(?!default\b)(const|function|class|let|var|async|\{)/gm)];
    expect(named).toEqual([]);
  });
});

describe("public contract hides providers", () => {
  const schemas = { FetchInputSchema, GrepInputSchema, SearchInputSchema, FetchResultSchema, GrepResultSchema, SearchResultSchema };
  it.each(Object.entries(schemas))("%s has no provider field", (_name, schema) => {
    expect(JSON.stringify(schema.toJSONSchema())).not.toMatch(/provider/i);
  });
});
