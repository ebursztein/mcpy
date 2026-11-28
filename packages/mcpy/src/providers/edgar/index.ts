/**
 * SEC EDGAR's XBRL API (data.sec.gov): what US-listed companies filed in
 * their 10-K and 10-Q reports, free and official. One company-concept call
 * per tag (a few KB to ~60 KB) rather than the whole company-facts file,
 * which is 3.9 MB for Apple and more for banks, past the response cap. The
 * SEC asks for at most 10 requests a second (tags are asked a few at a
 * time) and a User-Agent naming the tool and a contact: it answers 403 to
 * mcpy's default profile (it links to github.com) and to a bare "mcpy/1.0",
 * and 200 to EDGAR_USER_AGENT, which links to the SDK's public npm page
 * (verified 2026-11-28 from a Worker and a laptop). Tickers map to the SEC's company ids (CIK)
 * through its ticker list, which the service keeps a day (`directory`).
 */

import { getStockJson, pooled } from "../stock-http.js";
import type { FiledFact, FoundFundamentals, FundamentalMeasure, StockCapabilities, StockProvider } from "../stock-types.js";
import { ProviderId, type ProviderCall } from "../types.js";
import { ConceptResponseSchema, TickersResponseSchema, type ConceptFact } from "./schemas.js";

export const SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json";
export const SEC_CONCEPT = "https://data.sec.gov/api/xbrl/companyconcept";
export const EDGAR_CAPABILITIES: StockCapabilities = { quotes: false, history: false, fundamentals: true };
/** Tag requests in flight at once, well under the SEC's 10 a second. */
const CONCURRENCY = 4;
/** The ticker list is about 800 KB. */
const MAX_TICKERS_BYTES = 5_000_000;

interface Tag {
  taxonomy: "us-gaap" | "dei";
  name: string;
  unit: string;
}

const gaap = (name: string, unit = "USD"): Tag => ({ taxonomy: "us-gaap", name, unit });

/**
 * The tags behind each measure, preferred first. Companies change tags over
 * the years (Apple's revenue: SalesRevenueNet until 2018, then
 * RevenueFromContractWithCustomerExcludingAssessedTax), so every tag is read
 * and, for one period, the first tag that has it wins.
 */
export const TAGS: Readonly<Record<FundamentalMeasure, readonly Tag[]>> = {
  revenue: [
    gaap("RevenueFromContractWithCustomerExcludingAssessedTax"),
    gaap("Revenues"),
    gaap("SalesRevenueNet"),
    gaap("RevenueFromContractWithCustomerIncludingAssessedTax"),
  ],
  grossProfit: [gaap("GrossProfit")],
  operatingIncome: [gaap("OperatingIncomeLoss")],
  netIncome: [gaap("NetIncomeLoss")],
  epsDiluted: [gaap("EarningsPerShareDiluted", "USD/shares")],
  operatingCashFlow: [gaap("NetCashProvidedByUsedInOperatingActivities")],
  capex: [gaap("PaymentsToAcquirePropertyPlantAndEquipment")],
  assets: [gaap("Assets")],
  liabilities: [gaap("Liabilities")],
  equity: [gaap("StockholdersEquity"), gaap("StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")],
  cash: [gaap("CashAndCashEquivalentsAtCarryingValue"), gaap("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents")],
  longTermDebt: [gaap("LongTermDebt"), gaap("LongTermDebtNoncurrent")],
  // The cover page's count is the newest; companies with several share classes state it per class,
  // which this API leaves out (Alphabet), so the balance sheet's total stands in.
  sharesOutstanding: [{ taxonomy: "dei", name: "EntityCommonStockSharesOutstanding", unit: "shares" }, gaap("CommonStockSharesOutstanding", "shares")],
};

const REPORTS = /^10-[KQ](\/A)?$/;

/** The SEC's 10-digit company id. */
export const paddedCik = (cik: number | string) => String(cik).padStart(10, "0");

export const conceptUrl = (cik: string, tag: Tag) => `${SEC_CONCEPT}/CIK${cik}/${tag.taxonomy}/${tag.name}.json`;

/** A tag's facts from 10-K and 10-Q reports in `unit`; other forms (8-K, S-1) are left out. */
export function factsOf(entries: readonly ConceptFact[]): FiledFact[] {
  return entries.flatMap((e) =>
    e.form && REPORTS.test(e.form) && Number.isFinite(e.val) ? [{ value: e.val, end: e.end, ...(e.start ? { start: e.start } : {}), filed: e.filed, annual: e.form.startsWith("10-K") }] : [],
  );
}

/** Each measure's facts from every tag behind it; a period's first tag wins (TAGS order). */
export function mergeTags(perTag: readonly (FiledFact[] | undefined)[]): FiledFact[] {
  const seen = new Set<string>();
  const out: FiledFact[] = [];
  for (const facts of perTag) {
    const periods = new Set<string>();
    for (const f of facts ?? []) {
      const period = `${f.start ?? ""}/${f.end}`;
      if (seen.has(period)) continue;
      periods.add(period);
      out.push(f);
    }
    for (const p of periods) seen.add(p);
  }
  return out;
}

/** What SEC accepts: the tool and a public page about it. Names no deployment. */
export const EDGAR_USER_AGENT = "mcpy/1.0 (+https://www.npmjs.com/package/mcpy)";

export interface EdgarOptions {
  /** Default EDGAR_USER_AGENT. To name your own service, give its name and a contact URL or email. */
  userAgent?: string;
  costPerCall?: number;
}

/** SEC EDGAR: company fundamentals from 10-K and 10-Q filings. */
export function edgar(options: EdgarOptions = {}): StockProvider {
  const headers = (call: ProviderCall) => ({ accept: "application/json", "user-agent": options.userAgent ?? EDGAR_USER_AGENT });
  return {
    id: ProviderId.Edgar,
    costPerCall: options.costPerCall ?? 0,
    capabilities: EDGAR_CAPABILITIES,
    async directory(call) {
      const body = await getStockJson({ url: SEC_TICKERS, headers: headers(call), maxBytes: MAX_TICKERS_BYTES }, TickersResponseSchema, call, "SEC");
      const out: Record<string, string> = {};
      // The list is ordered by size: a ticker listed twice keeps its first (larger) company.
      for (const row of Object.values(body ?? {})) out[row.ticker.toUpperCase()] ??= paddedCik(row.cik_str);
      return out;
    },
    async fundamentals(_symbol, cik, call) {
      if (!cik) return undefined;
      const measures = Object.entries(TAGS) as [FundamentalMeasure, readonly Tag[]][];
      const jobs = measures.flatMap(([measure, tags]) => tags.map((tag) => ({ measure, tag })));
      let name: string | undefined;
      const answers = await pooled(jobs, CONCURRENCY, async ({ tag }) => {
        const body = await getStockJson({ url: conceptUrl(cik, tag), headers: headers(call), notFound: [404] }, ConceptResponseSchema, call, "SEC");
        name ??= body?.entityName ?? undefined;
        return body ? factsOf(body.units[tag.unit] ?? []) : undefined;
      });
      if (answers.every((a) => a === undefined)) return undefined;
      const facts: FoundFundamentals["facts"] = {};
      let at = 0;
      for (const [measure, tags] of measures) {
        const merged = mergeTags(answers.slice(at, at + tags.length));
        at += tags.length;
        if (merged.length) facts[measure] = merged;
      }
      return { name, facts };
    },
  };
}
