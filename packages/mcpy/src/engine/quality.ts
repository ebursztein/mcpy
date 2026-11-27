import { AttemptOutcome, ContentKind } from "../enums.js";
import type { FetchedPage } from "../providers/types.js";

/**
 * How the engine judges a page a provider returned:
 * - Ok:       usable page, stop here
 * - Final:    definitive answer (404/405/410, or an API's own JSON 401/403);
 *             escalating would only burn money
 * - Escalate: blocked or challenged; try the next provider.
 * Anything else the site answered is the answer, however short: the HTTP
 * status says what it is. A page that needs its JavaScript run is fetched
 * with `render: true`; mcpy does not guess that from the page's length (a
 * 200 from example.com was paid to a browser on every call, 2026-11-27).
 */
export type Verdict =
  | { outcome: typeof AttemptOutcome.Ok }
  | { outcome: typeof AttemptOutcome.Final; reason: string }
  | { outcome: typeof AttemptOutcome.Escalate; reason: string; salvageable: boolean };

/**
 * Answers about the request itself, which every source would get too. 405:
 * the URL does not take this method (seen live: a GET to TCGplayer's POST-only
 * sales API paid two sources for the same 405).
 */
const DEFINITIVE_STATUS = new Set([404, 405, 410]);

/**
 * An API refusing the request itself: a 401 or 403 whose body is a small JSON
 * value from the site, not a CDN's or bot wall's. Every source would get the
 * same answer (Kryptex's pool API, 2026-11-25: a worker chart closed to this
 * account answered 403 {"detail":"You do not have permission to perform this
 * action."} to the direct fetch and to three paid sources, which then reported
 * 502 and used up the client's daily budget).
 */
const REFUSAL_STATUS = new Set([401, 403]);
const MAX_REFUSAL_CHARS = 2_000;
/** Bot walls that answer in JSON (Cloudflare's error 1020 with Accept: application/json, ...). */
const WALL_JSON = /cloudflare|\bray[_ ]?id\b|akamai|incapsula|imperva|perimeterx|datadome|captcha|\bbot\b|access denied/i;

function isApiRefusal(page: FetchedPage): boolean {
  if (!REFUSAL_STATUS.has(page.status) || page.kind !== ContentKind.Json) return false;
  const body = page.content.trim();
  if (!body || body.length > MAX_REFUSAL_CHARS || WALL_JSON.test(body)) return false;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
}

/**
 * Non-standard success codes that bot walls answer with: Reblaze's 247
 * (Gumtree, 2026-11-22). Treated like a 403.
 */
const BOT_WALL_STATUS = new Set([247]);

/** Titles of bot-wall and challenge pages (Cloudflare, Akamai, Imperva, DataDome, ...). */
const CHALLENGE_TITLES = [
  /^just a moment\.*$/i,
  /^attention required!? \| cloudflare$/i,
  /^access denied$/i,
  /^(verifying|checking) (that )?(you are|you're|your browser)/i,
  /^pardon our interruption$/i,
  /^are you a (robot|human)\??$/i,
  /^ddos-guard$/i,
  /^security check(point)?$/i,
  /^vercel security checkpoint$/i,
  // Localized Cloudflare interstitials (Locanto, 2026-11-22) and Radware's ShieldSquare (Njuskalo).
  /^(one moment,? please|einen moment,? bitte|un instant,? s'il vous pla[iî]t|un momento,? por favor)[.…]*$/i,
  /^shieldsquare captcha$/i,
];

/**
 * Structural markers (script names, challenge endpoints) that only appear on
 * challenge pages. Checked only on small pages, so an article that mentions
 * them cannot trigger a paid fallback.
 */
const CHALLENGE_MARKUP = [
  /\bcf-chl-|\/cdn-cgi\/challenge-platform\/|\bcf_chl_opt\b/,
  /_Incapsula_Resource/,
  /captcha-delivery\.com/,
  /\bpx-captcha\b/,
  // AWS WAF challenge page (HTTP 202 with a token script; Jofogas, 2026-11-22): its own
  // globals, not the SDK name that ordinary pages using the WAF also load.
  /\bawsWafCookieDomainList\b|\bgokuProps\s*=/,
  // Reblaze's challenge script path, and Radware ShieldSquare's validation host.
  /["'/]rbzns[_a-z]*\.js|\/rbzns\//i,
  /\bvalidate\.perfdrive\.com\b/,
];
const MARKUP_SCAN_LIMIT = 30_000;

/** Challenge wording; counted only on tiny pages, where it is the whole message. */
const CHALLENGE_WORDING = [
  /\benable javascript and cookies to continue\b/i,
  /\bverifying you are (a )?human\b/i,
  /\bplease (verify|prove) (that )?you are (a )?human\b/i,
  /\bchecking (if the site connection is secure|your browser before accessing)\b/i,
];
const WORDING_SCAN_LIMIT = 3_000;

/**
 * Where a request lands when a site sends bots to a verification or captcha
 * page with HTTP 200 (MercadoLibre's /gz/account-verification and
 * /captcha/wall, 2026-11-22). Only the path of the final URL is checked, and
 * only when it differs from the URL asked for.
 */
const WALL_PATHS = /\/(account-verification|captcha(\/wall)?|bot-?check|human-?verification)(\/|$)/i;

function landedOnWall(page: FetchedPage): boolean {
  if (page.finalUrl === page.url) return false;
  try {
    return WALL_PATHS.test(new URL(page.finalUrl).pathname);
  } catch {
    return false;
  }
}

export function isChallenge(page: FetchedPage): boolean {
  if (landedOnWall(page)) return true;
  if (page.title && CHALLENGE_TITLES.some((re) => re.test(page.title!.trim()))) return true;
  if (page.content.length <= MARKUP_SCAN_LIMIT && CHALLENGE_MARKUP.some((re) => re.test(page.content))) return true;
  return page.content.length <= WORDING_SCAN_LIMIT && CHALLENGE_WORDING.some((re) => re.test(page.content));
}

export function assessPage(page: FetchedPage): Verdict {
  if (DEFINITIVE_STATUS.has(page.status)) return { outcome: AttemptOutcome.Final, reason: `HTTP ${page.status}` };
  if (isApiRefusal(page) && !isChallenge(page)) return { outcome: AttemptOutcome.Final, reason: `HTTP ${page.status} (the site's own refusal)` };
  if (BOT_WALL_STATUS.has(page.status)) return { outcome: AttemptOutcome.Escalate, reason: `HTTP ${page.status} (bot check)`, salvageable: false };
  if (page.status >= 400) return { outcome: AttemptOutcome.Escalate, reason: `HTTP ${page.status}`, salvageable: false };
  if (isChallenge(page)) return { outcome: AttemptOutcome.Escalate, reason: "bot challenge detected", salvageable: false };
  return { outcome: AttemptOutcome.Ok };
}
