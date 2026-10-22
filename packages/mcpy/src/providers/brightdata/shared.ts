import { ErrorCode } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import type { HttpResponse } from "../../http/client.js";

export interface BrightDataOptions {
  apiKey: string;
  /** Web Unlocker zone (pages) or SERP API zone (search). */
  zone: string;
  costPerCall?: number;
}

export const API = "https://api.brightdata.com/request";

export function fail(response: HttpResponse): never {
  throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}: ${response.text.slice(0, 200)}`, response.status);
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
