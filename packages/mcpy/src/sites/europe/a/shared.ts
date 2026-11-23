/**
 * What several europe-a sites need and the readers do not have yet:
 *
 * - Query relevance. Marktplaats, 2dehands, Subito, willhaben, tutti/anibis,
 *   Ricardo, Catawiki and OLX all answer with rows that match only some of
 *   the words (OR matching, typo tolerance, vector search). Probed
 *   2026-11-22: "qzxjvwk glurak zzqv" returns tractors on OLX and Glurak
 *   cards on Marktplaats; "black lotus" returns Lotus cars. Those rows are
 *   the site's "fewer words" filler, not results, so a row is kept only when
 *   every query word appears in the text the site gives for it (accents,
 *   case and ß/ł folded). Sites whose rows are often written in another
 *   script than the query (OLX Ukraine/Bulgaria transliterate "charizard" to
 *   "Чарізард") use the page gate instead: the page is empty when no row has
 *   every word, otherwise all rows are kept.
 * - Central European local time, for sites that state times without an
 *   offset (EU summer time: last Sunday of March to last Sunday of October).
 */

import { timestamp } from "../../readers/values.js";

export const Relevance = { Row: "row", Page: "page" } as const;
export type Relevance = (typeof Relevance)[keyof typeof Relevance];

const SPECIAL: Readonly<Record<string, string>> = { ß: "ss", ł: "l", ø: "o", æ: "ae", œ: "oe", đ: "d", ı: "i" };

/** Lowercase, accents removed, letters that do not decompose mapped by hand. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[ßłøæœđı]/g, (c) => SPECIAL[c] ?? c);
}

/** The query's words, folded. */
export function words(query: string): string[] {
  return fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Whether every query word appears in one of the texts. */
export function matchesAll(query: string, ...texts: (string | undefined | null)[]): boolean {
  const ws = words(query);
  if (ws.length === 0) return true;
  const hay = fold(texts.filter((t): t is string => typeof t === "string").join(" "));
  return ws.every((w) => hay.includes(w));
}

/** The items that are results for the query, by the site's relevance mode. */
export function relevant<T>(query: string, items: readonly T[], text: (item: T) => (string | undefined | null)[], mode: Relevance): T[] {
  const hit = (item: T) => matchesAll(query, ...text(item));
  if (mode === Relevance.Row) return items.filter(hit);
  return items.some(hit) ? [...items] : [];
}

function lastSunday(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/** "+01:00" or "+02:00": the CET/CEST offset on a local date-time. */
export function cetOffset(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2})/.exec(local.trim());
  if (!m) return "+01:00";
  const [y, mo, d, h] = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4])];
  const start = lastSunday(y, 2);
  const end = lastSunday(y, 9);
  const after = (day: number, hour: number) => d > day || (d === day && h >= hour);
  const summer = (mo > 2 && mo < 9) || (mo === 2 && after(start, 2)) || (mo === 9 && !after(end, 3));
  return summer ? "+02:00" : "+01:00";
}

/** A Central European local time ("2026-11-23 01:21:02") as ISO 8601 with its offset. */
export const cetTime = (value: unknown): string | undefined => (typeof value === "string" ? timestamp(value, cetOffset(value)) : undefined);
