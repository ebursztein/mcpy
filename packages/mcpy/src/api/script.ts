/**
 * Fetch scripts: the caller's JavaScript runs on the whole page and only its
 * return value goes back, so a large page costs one call instead of many
 * parts. The host supplies the runner (the server uses a Worker Loader).
 */

import { ErrorCode } from "../enums.js";
import { McpyError } from "../errors.js";
import { MAX_OUTPUT_CHARS } from "../schemas.js";

/** What a script's default export receives. */
export interface ScriptPage {
  url: string;
  final_url: string;
  status: number;
  title?: string;
  content: string;
}

/** Runs `script` (an ES module) on `page` and returns its default export's result as JSON text. */
export type ScriptRunner = (script: string, page: ScriptPage) => Promise<string>;

export async function runScript(runner: ScriptRunner | undefined, script: string, page: ScriptPage): Promise<string> {
  if (!runner) throw new McpyError(ErrorCode.NoProviders, "scripts are not enabled on this server");
  try {
    return await runner(script, page);
  } catch (err) {
    throw new McpyError(ErrorCode.InvalidInput, `script failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Points callers at `script` when a page cannot come back in one call. */
export function scriptTip(totalChars: number): string | undefined {
  if (totalChars <= MAX_OUTPUT_CHARS) return undefined;
  return `This page is ${totalChars} characters. To get only what you need in one call, pass script: a JavaScript module whose default export takes the page ({ url, final_url, status, title, content }) and returns the data you want, e.g. export default (page) => page.content.match(/<h1>(.*?)<\\/h1>/)?.[1]`;
}
