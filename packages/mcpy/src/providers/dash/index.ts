import { ErrorCode, UserAgentProfile } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import type { CryptoCapabilities, CryptoProvider, FoundCoinDay, HistoryRequest } from "../crypto-types.js";
import { fillSteps } from "../step-fill.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { BlockTxsSchema, DayBlocksSchema } from "./schemas.js";

export interface DashOptions {
  costPerCall?: number;
}

/** Dash Core Group's public Insight explorer (no key). */
const API = "https://insight.dash.org/insight-api";
const SYMBOL = "DASH";
const DAY_MS = 86_400_000;
/** Ordinary coinbase outputs: miner, masternode, Platform's credit pool. More is a superblock. */
const ORDINARY_OUTPUTS = 3;
/** Blocks tried from the day's end for one that is not a superblock (one in 16,616 is). */
const BLOCKS_TRIED = 3;
/** Two readings within this share are one step: per-block fees move a coinbase by about 0.01%; a yearly step is 7%. */
const SAME_STEP = 0.005;
/** Readings for one window: two requests each; a window without a step takes two. */
export const MAX_READS = 16;

export const DASH_CAPABILITIES: CryptoCapabilities = { totals: false, live: false, history: true };

export const dayBlocksUrl = (day: string) => `${API}/blocks?blockDate=${day}&limit=${BLOCKS_TRIED}`;
export const blockTxsUrl = (hash: string) => `${API}/txs?block=${hash}`;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => {
  const days: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) days.push(dayOf(t));
  return days;
};

export const sameStep = (a: number, b: number) => Math.abs(a - b) <= SAME_STEP * Math.max(a, b);

/** Insight answers 403 to a request with no User-Agent (live 2026-11-25), so mcpy names itself. */
async function get<T>(url: string, schema: Parameters<ProviderCall["http"]["json"]>[1], call: ProviderCall): Promise<T> {
  const headers = { "User-Agent": call.userAgent(UserAgentProfile.Default) };
  const { response, data } = await call.http.json({ url, headers }, schema, call.context);
  if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
  return data as T;
}

/** The coinbase payout of the day's last ordinary block, in DASH; undefined when none of its last blocks has one. */
export async function coinbaseAtDayEnd(day: string, call: ProviderCall): Promise<number | undefined> {
  const { blocks } = await get<{ blocks: { hash: string }[] }>(dayBlocksUrl(day), DayBlocksSchema, call);
  for (const block of blocks) {
    const { txs } = await get<{ txs: { isCoinBase?: boolean | null; valueOut: number; vout: unknown[] }[] }>(blockTxsUrl(block.hash), BlockTxsSchema, call);
    const coinbase = txs.find((t) => t.isCoinBase);
    if (coinbase && coinbase.vout.length <= ORDINARY_OUTPUTS && coinbase.valueOut > 0) return coinbase.valueOut;
  }
  return undefined;
}

/**
 * Each day's coinbase payout per block, read at its last block and at the day before's (its
 * start). A day whose start and end differ holds a step: it is left out, never guessed.
 */
export async function coinbaseByDay(from: string, to: string, call: ProviderCall): Promise<FoundCoinDay[]> {
  const days = daysBetween(dayOf(Date.parse(from) - DAY_MS), to);
  const values = await fillSteps(days, (d) => coinbaseAtDayEnd(d, call), { maxReads: MAX_READS, same: sameStep });
  const found: FoundCoinDay[] = [];
  for (let i = 1; i < days.length; i++) {
    const [start, end] = [values[i - 1], values[i]];
    if (start === undefined || end === undefined || !sameStep(start, end)) continue;
    found.push({ symbol: SYMBOL, date: days[i], coinbasePerBlockCoins: end });
  }
  return found;
}

/**
 * Dash's coinbase payout per block on complete past days, from Dash Core
 * Group's Insight explorer: what DASH's miners' subsidy is worked out from
 * (rules.ts), since its reported issuance holds the treasury's superblocks.
 */
export function dash(options: DashOptions = {}): CryptoProvider {
  return {
    id: ProviderId.Dash,
    costPerCall: options.costPerCall ?? 0,
    capabilities: DASH_CAPABILITIES,
    async history(req: HistoryRequest, call) {
      if (!req.symbols.some((s) => s.toUpperCase() === SYMBOL)) return [];
      return coinbaseByDay(req.from, req.to, call);
    },
  };
}
