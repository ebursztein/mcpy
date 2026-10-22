import { AttemptOutcome } from "../enums.js";
import type { FetchedPage } from "../providers/types.js";

/**
 * How the engine judges a page a provider returned:
 * - Ok:       usable page, stop here
 * - Final:    definitive answer (404/410); escalating would only burn money
 * - Escalate: blocked, challenged or empty; try the next provider
 */
export type Verdict =
  | { outcome: typeof AttemptOutcome.Ok }
  | { outcome: typeof AttemptOutcome.Final; reason: string }
  | { outcome: typeof AttemptOutcome.Escalate; reason: string };

const DEFINITIVE_STATUS = new Set([404, 410]);

const CHALLENGE_MARKERS = [
  /<title>\s*just a moment\.\.\.\s*<\/title>/i,
  /\bcf-chl-|challenge-platform|cf_chl_opt/i,
  /attention required!\s*\|\s*cloudflare/i,
  /\b(verify|prove) (that )?you are (a )?human\b/i,
  /\bplease enable (javascript|js) and cookies\b/i,
  /\bpx-captcha\b|\bdatadome\b|\bperimeterx\b/i,
  /^\s*access denied\s*$/im,
];

/** Below this many characters a page is treated as empty (JS app shell). */
export const MIN_CONTENT_CHARS = 200;
/** Challenge pages are small; only scan the head of the document. */
const SCAN_CHARS = 20_000;

export function assessPage(page: FetchedPage): Verdict {
  if (DEFINITIVE_STATUS.has(page.status)) return { outcome: AttemptOutcome.Final, reason: `HTTP ${page.status}` };
  if (page.status >= 400) return { outcome: AttemptOutcome.Escalate, reason: `HTTP ${page.status}` };

  const head = page.content.slice(0, SCAN_CHARS);
  if (CHALLENGE_MARKERS.some((re) => re.test(head))) return { outcome: AttemptOutcome.Escalate, reason: "bot challenge detected" };

  if (page.content.trim().length < MIN_CONTENT_CHARS) {
    return { outcome: AttemptOutcome.Escalate, reason: "content too short (likely JS-rendered)" };
  }
  return { outcome: AttemptOutcome.Ok };
}
