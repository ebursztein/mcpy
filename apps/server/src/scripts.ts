/**
 * Runs fetch scripts with the Worker Loader binding: Workers cannot eval a
 * string, so each script is loaded as its own module. The id is the script's
 * hash, so a script is loaded once and reused while its isolate stays warm.
 */

import type { ScriptPage, ScriptRunner } from "mcpy";

const COMPATIBILITY_DATE = "2026-10-01";

/** Calls the script's default export and returns its result as JSON text. */
const MAIN = `import { WorkerEntrypoint } from "cloudflare:workers";
import extract from "./script.js";
export default class extends WorkerEntrypoint {
  async run(page) {
    return JSON.stringify((await extract(page)) ?? null);
  }
}`;

interface ScriptEntrypoint {
  run(page: ScriptPage): Promise<string>;
}

/** The part of the Worker Loader binding this module uses. */
export interface WorkerLoaderLike {
  get(
    id: string,
    code: () => Promise<{ compatibilityDate: string; mainModule: string; modules: Record<string, string> }>,
  ): { getEntrypoint(): ScriptEntrypoint };
}

export function workerLoaderScripts(loader: WorkerLoaderLike): ScriptRunner {
  return async (script, page) => {
    const id = `fetch-script:${await sha256(script)}`;
    const worker = loader.get(id, async () => ({
      compatibilityDate: COMPATIBILITY_DATE,
      mainModule: "main.js",
      modules: { "main.js": MAIN, "script.js": script },
    }));
    return worker.getEntrypoint().run(page);
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
