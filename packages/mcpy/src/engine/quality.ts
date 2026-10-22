import { AttemptOutcome, ContentKind } from "../enums.js";
import type { FetchedPage } from "../providers/types.js";

/**
 * How the engine judges a page a provider returned:
 * - Ok:       usable page, stop here
 * - Final:    definitive answer (404/410); escalating would only burn money
 * - Escalate: blocked, challenged or empty; try the next provider.
 *             `salvageable` marks a real but thin page (e.g. a short HTML
 *             page): if no provider does better, it is returned as is.
 */
export type Verdict =
  | { outcome: typeof AttemptOutcome.Ok }
  | { outcome: typeof AttemptOutcome.Final; reason: string }
  | { outcome: typeof AttemptOutcome.Escalate; reason: string; salvageable: boolean };

const DEFINITIVE_STATUS = new Set([404, 410]);

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
];

/**
 * Structural markers (script names, challenge endpoints) that only appear on
 * challenge pages. Checked only on small pages, so an article that mentions
 * them cannot trigger a paid fallback.
 */
const CHALLENGE_MARKUP = [/\bcf-chl-|\/cdn-cgi\/challenge-platform\/|\bcf_chl_opt\b/, /_Incapsula_Resource/, /captcha-delivery\.com/, /\bpx-captcha\b/];
const MARKUP_SCAN_LIMIT = 30_000;

/** Challenge wording; counted only on tiny pages, where it is the whole message. */
const CHALLENGE_WORDING = [
  /\benable javascript and cookies to continue\b/i,
  /\bverifying you are (a )?human\b/i,
  /\bplease (verify|prove) (that )?you are (a )?human\b/i,
  /\bchecking (if the site connection is secure|your browser before accessing)\b/i,
];
const WORDING_SCAN_LIMIT = 3_000;

/** HTML pages below this many characters are treated as JS app shells. */
export const MIN_HTML_CONTENT_CHARS = 200;

export function isChallenge(page: FetchedPage): boolean {
  if (page.title && CHALLENGE_TITLES.some((re) => re.test(page.title!.trim()))) return true;
  if (page.content.length <= MARKUP_SCAN_LIMIT && CHALLENGE_MARKUP.some((re) => re.test(page.content))) return true;
  return page.content.length <= WORDING_SCAN_LIMIT && CHALLENGE_WORDING.some((re) => re.test(page.content));
}

export function assessPage(page: FetchedPage): Verdict {
  if (DEFINITIVE_STATUS.has(page.status)) return { outcome: AttemptOutcome.Final, reason: `HTTP ${page.status}` };
  if (page.status >= 400) return { outcome: AttemptOutcome.Escalate, reason: `HTTP ${page.status}`, salvageable: false };
  if (isChallenge(page)) return { outcome: AttemptOutcome.Escalate, reason: "bot challenge detected", salvageable: false };

  // Short text, JSON or native markdown is just short. Only HTML can be an
  // empty shell that a real browser would fill in.
  if (page.kind === ContentKind.Html && page.content.trim().length < MIN_HTML_CONTENT_CHARS) {
    return { outcome: AttemptOutcome.Escalate, reason: "content too short (likely JS-rendered)", salvageable: true };
  }
  return { outcome: AttemptOutcome.Ok };
}
