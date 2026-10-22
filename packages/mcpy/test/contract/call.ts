/** Builds the ProviderCall the engine would hand a provider, over a real HttpClient. */

import { USER_AGENTS } from "mcpy";
import type { ProviderCall } from "mcpy/providers";
import { Telemetry } from "mcpy/telemetry";
import { HttpClient } from "../../src/http/client.js";
import { ProviderFailure } from "../../src/errors.js";

export const MAX_BYTES = 1_000_000;
export const TIMEOUT_MS = 20_000;

export function providerCall(fetch: typeof globalThis.fetch, retries = 0): ProviderCall {
  return {
    http: new HttpClient({ fetch, retry: { retries, baseDelayMs: 1, maxDelayMs: 2 } }),
    context: { signal: new AbortController().signal, deadlineAt: Date.now() + 60_000, maxBytes: MAX_BYTES, telemetry: Telemetry.noop() },
    userAgent: (profile) => USER_AGENTS[profile],
    timeoutMs: TIMEOUT_MS,
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Await a rejected provider call and return its ProviderFailure. */
export async function failureOf(promise: Promise<unknown>): Promise<ProviderFailure> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof ProviderFailure)) throw new Error(`expected ProviderFailure, got ${String(err)}`);
  return err;
}
