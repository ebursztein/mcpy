import { ErrorCode } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import type { CryptoCapabilities, CryptoProvider, FoundCoinDay, HistoryRequest } from "../crypto-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { HistoryResponseSchema, SampleSchema, type Sample } from "./schemas.js";
import { issuedByDay } from "./subsidy.js";

export interface KaspaOptions {
  costPerCall?: number;
}

const API = "https://api.kaspa.org/info/hashrate/history";
const SYMBOL = "KAS";
const DAY_SECONDS = 86_400;
const HOUR_MS = 3_600_000;

/** A day is reported only when its samples cover it (normally 96, one per 15 minutes). */
export const MIN_SAMPLES_PER_DAY = 80;

export const KASPA_CAPABILITIES: CryptoCapabilities = { totals: false, live: false, history: true };

/**
 * Months spanning from..to, "YYYY-MM". A month is one call of about 570 KB
 * (verified live 2026-11-25: 2,963 samples for October 2026); a 40-day window
 * spans at most 3 months, under 2 MB. Day calls are about 18.5 KB each but
 * would take up to 40 requests.
 */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.slice(0, 7).split("-").map(Number);
  const last = to.slice(0, 7);
  for (;;) {
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    if (ym > last) return months;
    months.push(ym);
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
}

export const historyUrl = (period: string) => `${API}/${period}`;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The day's samples span it: enough of them, the first before 01:00 UTC, the last after 23:00. */
export function coversDay(day: string, samples: Sample[]): boolean {
  if (samples.length < MIN_SAMPLES_PER_DAY) return false;
  const start = Date.parse(`${day}T00:00:00Z`);
  return samples[0].timestamp < start + HOUR_MS && samples[samples.length - 1].timestamp > start + 23 * HOUR_MS;
}

/**
 * Blocks a second, read off a sample: the API states its hashrate as
 * difficulty × 2 × blocks a second (2 hashes per unit of difficulty), so the
 * ratio is 20 at 10 blocks a second (since Crescendo, 2025-05-05) and was 2
 * before.
 */
const blocksPerSecond = (s: Sample) => Math.round((s.hashrate_kh * 1000) / (s.difficulty * 2));

/**
 * Blocks in the day: the protocol's rate × 86,400 s, when every sample shows
 * the same rate. 864,000 since Crescendo, 86,400 before; on 2025-05-05 the
 * rate changed mid-day and the count is left out. The daaScore was checked as
 * a measured count instead (live, Oct–Nov 2026): between the days' last
 * samples it ran 855,912 to 870,270, but only because those samples are not
 * at midnight (23:45 to 23:59); per second it held 10.000 ± 0.013, so the
 * protocol rate is the better figure.
 */
export function blocksInDay(samples: Sample[]): number | undefined {
  const rates = new Set(samples.map(blocksPerSecond));
  if (rates.size !== 1) return undefined;
  const [rate] = rates;
  return rate > 0 ? rate * DAY_SECONDS : undefined;
}

/** Each complete UTC day in from..to, before `today`, with its samples oldest first; days the samples do not cover are left out. */
export function samplesByDay(raw: unknown[], from: string, to: string, today: string): Map<string, Sample[]> {
  const byDay = new Map<string, Sample[]>();
  for (const item of raw) {
    const parsed = SampleSchema.safeParse(item);
    if (!parsed.success) continue;
    const day = dayOf(parsed.data.timestamp);
    if (day < from || day > to || day >= today) continue;
    const list = byDay.get(day) ?? [];
    list.push(parsed.data);
    byDay.set(day, list);
  }
  const covered = new Map<string, Sample[]>();
  for (const [date, unsorted] of byDay) {
    const samples = dedupe(unsorted.sort((a, b) => a.timestamp - b.timestamp));
    if (coversDay(date, samples)) covered.set(date, samples);
  }
  return covered;
}

/**
 * Complete UTC days in from..to, before `today`, from the samples (any order).
 *
 * networkHashrateHs is the mean of the day's samples. Each sample's figure is
 * difficulty × 2 × blocks a second, so the mean is 2 × blocks a second × the
 * mean difficulty, which is the day's work (each block's difficulty × 2
 * hashes, summed over blocks that arrive at the fixed protocol rate)
 * ÷ 86,400 s: block luck does not enter it.
 * difficulty is the day's last sample's.
 */
export function daysFromSamples(raw: unknown[], from: string, to: string, today: string): FoundCoinDay[] {
  return daysOf(samplesByDay(raw, from, to, today));
}

function daysOf(byDay: ReadonlyMap<string, Sample[]>): FoundCoinDay[] {
  const days: FoundCoinDay[] = [];
  for (const [date, samples] of byDay) {
    const sum = samples.reduce((total, s) => total + s.hashrate_kh * 1000, 0);
    days.push({
      symbol: SYMBOL,
      name: "Kaspa",
      date,
      networkHashrateHs: sum / samples.length,
      difficulty: samples[samples.length - 1].difficulty,
      blocks: blocksInDay(samples),
    });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/** One sample per timestamp (sorted input), in case periods overlap. */
const dedupe = (sorted: Sample[]) => sorted.filter((s, i) => i === 0 || s.timestamp !== sorted[i - 1].timestamp);

async function fetchPeriod(period: string, call: ProviderCall): Promise<unknown[]> {
  const { response, data } = await call.http.json({ url: historyUrl(period) }, HistoryResponseSchema, call.context);
  if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
  return data;
}

/**
 * Kaspa's public REST API (no key): KAS's network hashrate, difficulty, block
 * count and issuance for complete past days. Issuance is the day's blocks × the
 * subsidy its coinbases state (subsidy.ts); if those reads fail, the days come
 * without it. No price or fees.
 */
export function kaspa(options: KaspaOptions = {}): CryptoProvider {
  return {
    id: ProviderId.Kaspa,
    costPerCall: options.costPerCall ?? 0,
    capabilities: KASPA_CAPABILITIES,
    async history(req: HistoryRequest, call) {
      if (!req.symbols.some((s) => s.toUpperCase() === SYMBOL)) return [];
      const today = new Date().toISOString().slice(0, 10);
      const periods = await Promise.all(monthsBetween(req.from, req.to).map((m) => fetchPeriod(m, call)));
      const byDay = samplesByDay(periods.flat(), req.from, req.to, today);
      const days = daysOf(byDay);
      const blocks = new Map(days.map((d) => [d.date, d.blocks]));
      const issued = await issuedByDay(byDay, (day) => blocks.get(day), call).catch(() => new Map<string, number>());
      return days.map((d) => (issued.has(d.date) ? { ...d, issuedCoins: issued.get(d.date) } : d));
    },
  };
}
