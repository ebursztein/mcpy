/**
 * Turning what a page states into typed values, without guessing. Amounts
 * follow the local convention that a final separator followed by one or two
 * digits is the decimal point (4.250,00 and 4,250.00 are both 4250; 1.234 is
 * 1234). Times must carry a date; relative ages stay text.
 */

/** Major units from a stated amount, or undefined when there is no positive number. */
export function amount(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  // The first number only: "+$22.10 delivery in 2-4 days" is 22.10, a range "20 – 45 €" is 20.
  // Group separators may be spaces (also narrow and no-break) or apostrophes, never a run of them.
  const m = /\d(?:[\d.,'\u00a0\u202f ]?\d)*/.exec(value);
  if (!m) return undefined;
  const digits = m[0].replace(/[\s\u00a0\u202f']/g, "");
  const last = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
  const decimals = last < 0 ? 0 : digits.length - last - 1;
  const n = Number(last >= 0 && decimals <= 2 ? `${digits.slice(0, last).replace(/[.,]/g, "")}.${digits.slice(last + 1)}` : digits.replace(/[.,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** An integer count from "1,240", "1.2K", "10000+", 55. */
export function count(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const m = /([\d.,]+)\s*([kKmM])?/.exec(value.replace(/\s/g, ""));
  if (!m) return undefined;
  const scale = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  const base = scale > 1 ? Number(m[1]!.replace(",", ".")) : Number(m[1]!.replace(/[.,]/g, ""));
  const n = Math.round(base * scale);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/** ISO 8601 with offset from a stated time: ISO text, epoch seconds or ms. Text without a date returns undefined. */
export function timestamp(value: unknown, defaultOffset = "Z"): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (/^\d{10,13}$/.test(s)) return timestamp(Number(s));
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return undefined;
  const [, y, mo, d, h = "00", mi = "00", sec = "00", off] = m;
  const offset = off ? (off === "Z" ? "Z" : off.length === 5 ? `${off.slice(0, 3)}:${off.slice(3)}` : off) : defaultOffset;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${sec}${offset}`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

/** Trimmed text, or undefined for empty, null or non-text values. */
export function str(value: unknown, max = 500): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const t = value.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

export const q = encodeURIComponent;
export const plus = (term: string): string => q(term).replace(/%20/g, "+");
export const dash = (term: string): string => q(term).replace(/%20/g, "-");
