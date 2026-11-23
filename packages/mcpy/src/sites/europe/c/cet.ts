/**
 * Central European local times (Prague, Bratislava, Belgrade) stated without
 * an offset: CET (+01:00), or CEST (+02:00) between the EU switch dates (last
 * Sunday of March and of October, 01:00 UTC). Sites in this group print
 * "2026-11-16 13:34:33" or "23.11. 2026" and mean their own clock.
 */

import { timestamp } from "../../readers/values.js";

function lastSunday(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
}

/** The offset in force at a local wall time "YYYY-MM-DD[ HH:MM[:SS]]". */
export function cetOffset(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(local);
  if (!m) return "+01:00";
  const year = Number(m[1]);
  const at = Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 12), Number(m[5] ?? 0)) - 3_600_000;
  return at >= lastSunday(year, 2) && at < lastSunday(year, 9) ? "+02:00" : "+01:00";
}

/** ISO 8601 with the CET/CEST offset from a local "YYYY-MM-DD[ HH:MM[:SS]]". */
export function cetTime(local: string | undefined): string | undefined {
  if (!local) return undefined;
  return timestamp(local.trim(), cetOffset(local.trim()));
}

/** "23.11. 2026" / "8.11.2026" (day.month. year) -> "2026-11-23". */
export function dottedDate(text: string | undefined): string | undefined {
  const m = text ? /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(text) : null;
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : undefined;
}
