/**
 * What the Japan and Korea flea-market readers share: telling a site's
 * fuzzy or semantic "nothing matched, here is something close" page apart
 * from real results, and recognising Korean buyer posts.
 */

const fold = (s: string): string => s.normalize("NFKC").toLowerCase();

/**
 * True when not one row states any word of the query. Rakuma (n-gram), Daangn
 * (semantic) and PayPay Flea (vector retry) answer a query that matches
 * nothing with unrelated rows instead of an empty page; such a page is empty.
 * One row stating a query word keeps the whole page, so this never filters
 * rows, it only refuses to call filler a result.
 */
export function noLiteralMatch(query: string, texts: readonly (string | undefined)[]): boolean {
  const words = fold(query).split(/[\s　]+/).filter((w) => w.length >= 2);
  if (!words.length || !texts.length) return false;
  return !texts.some((t) => t !== undefined && words.some((w) => fold(t).includes(w)));
}

/**
 * Korean buyer posts say so in the title: 삽니다 / 구합니다 / 구해요 / 구매합니다
 * / 매입합니다, or a leading 구매) 매입) [구함] tag. Sellers' "구매하실 분" does not match.
 */
const KOREAN_WANTED = /삽니다|구합니다|구해요|구매합니다|매입합니다|^\s*[[(【]?\s*(?:구매|매입|구함)\s*[\])】:]/;

export const koreanWanted = (title: string | undefined): boolean => title !== undefined && KOREAN_WANTED.test(title);
