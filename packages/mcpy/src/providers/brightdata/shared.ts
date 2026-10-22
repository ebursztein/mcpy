import { ErrorCode } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import type { HttpResponse } from "../../http/client.js";

export interface BrightDataOptions {
  apiKey: string;
  /** Web Unlocker zone (pages) or SERP API zone (search). */
  zone: string;
  costPerCall?: number;
  /**
   * Search only: country and language used when a search does not set them.
   * Without them Bright Data geolocates its proxy at random (a US caller can
   * get Mexican results). Defaults: "us" and "en".
   */
  defaultCountry?: string;
  defaultLanguage?: string;
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
