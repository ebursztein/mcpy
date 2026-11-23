/**
 * Chrome shows a response that is not HTML (JSON, plain text) inside a page
 * of its own: one <pre> holding the text, plus, for JSON, an empty formatter
 * div. A browser provider that reads the rendered page gets that wrapper, not
 * the body the server sent (Woyouminer's WooCommerce JSON, 2026-11-23).
 *
 * The binding renderer reads the raw body from the navigation response, so
 * this is the fallback for renderers that only return the rendered page
 * (Browser Run's REST API). It matches Chrome's viewer page exactly and
 * nothing else: a site's own page with a <pre> in it is left alone.
 */

const VIEWER =
  /^<html><head>(?:<meta name="color-scheme" content="light dark">|<meta charset="utf-8">)*<\/head><body><pre(?: style="[^"]*")?>([\s\S]*)<\/pre>(?:<div class="json-formatter-container"><\/div>)?<\/body><\/html>$/;

/** innerHTML escapes text with these four only; &amp; last, so "&amp;lt;" stays "&lt;". */
function unescapeText(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function isJson(text: string): boolean {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/** The body Chrome wrapped, with the content type it most likely had; undefined for any other page. */
export function unwrapBrowserViewer(html: string): { body: string; contentType: string } | undefined {
  const m = VIEWER.exec(html.trim());
  if (!m) return undefined;
  const body = unescapeText(m[1]!);
  return { body, contentType: isJson(body) ? "application/json" : "text/plain" };
}
