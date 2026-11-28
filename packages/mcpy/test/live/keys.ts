/** Provider keys for the live suites: apps/server/.dev.vars, then the environment. */

import { existsSync, readFileSync } from "node:fs";

const DEV_VARS = new URL("../../../../apps/server/.dev.vars", import.meta.url);

function loadKeys(): Record<string, string> {
  const fromFile = existsSync(DEV_VARS)
    ? Object.fromEntries(
        readFileSync(DEV_VARS, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#") && l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      )
    : {};
  return { ...fromFile, ...(process.env as Record<string, string>) };
}

export const k = loadKeys();
export const has = (...names: string[]) => names.every((n) => !!k[n]);

