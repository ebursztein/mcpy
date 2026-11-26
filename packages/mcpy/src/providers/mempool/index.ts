import { ErrorCode, UserAgentProfile } from "../../enums.js";
import { ProviderFailure } from "../../errors.js";
import type { CryptoCapabilities, CryptoProvider, FoundCoinDay, HistoryRequest } from "../crypto-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { AdjustmentsResponseSchema, type Adjustment } from "./schemas.js";

export interface MempoolOptions {
  costPerCall?: number;
  /** Longest wait for one explorer's retarget list (default READ_TIMEOUT_MS). */
  readTimeoutMs?: number;
}

/**
 * mempool.space answers a Worker in 0.1 to 0.7 s, but now and then holds the connection open with
 * no answer (20 s and more, from Cloudflare, 2026-11-25). Waiting that out held every BTC/LTC
 * call for the crypto fan-out's whole grace period, so a list not in by then is given up on.
 */
export const READ_TIMEOUT_MS = 4_000;

/** The explorer of each coin: mempool.space and its Litecoin instance, litecoinspace.org. */
export const EXPLORERS: Readonly<Record<string, string>> = {
  BTC: "https://mempool.space",
  LTC: "https://litecoinspace.org",
};

/**
 * Every retarget since the coin's genesis (BTC 470, 21.5 KB; LTC 1,596, 75 KB on 2026-11-25), so
 * any span is answered with the retarget in force on its first day.
 */
export const adjustmentsUrl = (symbol: string) => `${EXPLORERS[symbol]}/api/v1/mining/difficulty-adjustments/all`;

export const MEMPOOL_CAPABILITIES: CryptoCapabilities = { totals: false, live: false, history: true };

const DAY_SECONDS = 86_400;
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const nextDay = (day: string) => new Date((dayStart(day) + DAY_SECONDS) * 1000).toISOString().slice(0, 10);

/**
 * Each day from..to with the difficulty in force at its last block: the last retarget whose block
 * is timed before the next UTC midnight (a retarget is a block, so none falls between a day's last
 * block and its end). Block times are the miners' and may run a little out of order; a retarget
 * timed within minutes of midnight is placed by its own timestamp. A day no listed retarget
 * precedes is left out.
 */
export function daysFromAdjustments(symbol: string, adjustments: Adjustment[], from: string, to: string): FoundCoinDay[] {
  const byTime = [...adjustments].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const days: FoundCoinDay[] = [];
  let i = -1;
  for (let day = from; day <= to; day = nextDay(day)) {
    const end = dayStart(day) + DAY_SECONDS;
    while (i + 1 < byTime.length && byTime[i + 1][0] < end) i++;
    if (i >= 0) days.push({ symbol, date: day, difficulty: byTime[i][2] });
  }
  return days;
}

async function fetchAdjustments(symbol: string, call: ProviderCall, timeoutMs: number): Promise<Adjustment[]> {
  const signal = AbortSignal.any([call.context.signal, AbortSignal.timeout(timeoutMs)]);
  const headers = { "User-Agent": call.userAgent(UserAgentProfile.Default) };
  const { response, data } = await call.http.json({ url: adjustmentsUrl(symbol), headers }, AdjustmentsResponseSchema, { ...call.context, signal });
  if (response.status >= 400) throw new ProviderFailure(ErrorCode.UpstreamFailed, `HTTP ${response.status}`, response.status);
  return data;
}

/**
 * mempool.space's open API and its Litecoin instance (no key): the difficulty at each complete
 * day's last block for BTC and LTC, read off the coin's retarget history (a new difficulty every
 * 2,016 blocks). Nothing else: prices and the network's work come from the other sources. An
 * explorer that fails or stalls costs only its own coin's difficulty; the other coin's days stand.
 */
export function mempool(options: MempoolOptions = {}): CryptoProvider {
  return {
    id: ProviderId.Mempool,
    costPerCall: options.costPerCall ?? 0,
    capabilities: MEMPOOL_CAPABILITIES,
    async history(req: HistoryRequest, call) {
      const symbols = [...new Set(req.symbols.map((s) => s.toUpperCase()))].filter((s) => s in EXPLORERS);
      const timeoutMs = options.readTimeoutMs ?? READ_TIMEOUT_MS;
      const lists = await Promise.allSettled(symbols.map((s) => fetchAdjustments(s, call, timeoutMs)));
      const failed = lists.find((l): l is PromiseRejectedResult => l.status === "rejected");
      const days = symbols.flatMap((s, n) => {
        const list = lists[n];
        return list.status === "fulfilled" ? daysFromAdjustments(s, list.value, req.from, req.to) : [];
      });
      // Nothing from any explorer is the source's failure, for the chain to record.
      if (!days.length && failed) throw failed.reason;
      return days;
    },
  };
}
