import type { FetchedPage } from "../providers/types";

/**
 * - ok:       usable page, stop here
 * - final:    definitive answer (e.g. 404); escalating would only burn money
 * - escalate: blocked, challenged or empty; try the next provider
 */
export type Verdict = { kind: "ok" } | { kind: "final"; reason: string } | { kind: "escalate"; reason: string };

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

// Below this many characters of content, a page is treated as empty
// (typically a JS app shell that needs a real browser).
const MIN_CONTENT_CHARS = 200;

export function assessPage(page: FetchedPage): Verdict {
  if (DEFINITIVE_STATUS.has(page.status)) return { kind: "final", reason: `HTTP ${page.status}` };
  if (page.status >= 400) return { kind: "escalate", reason: `HTTP ${page.status}` };

  // Only scan the head of the document; challenge pages are small.
  const head = page.content.slice(0, 20_000);
  const marker = CHALLENGE_MARKERS.find((re) => re.test(head));
  if (marker) return { kind: "escalate", reason: "bot challenge detected" };

  if (page.content.trim().length < MIN_CONTENT_CHARS) {
    return { kind: "escalate", reason: "content too short (likely JS-rendered)" };
  }
  return { kind: "ok" };
}
