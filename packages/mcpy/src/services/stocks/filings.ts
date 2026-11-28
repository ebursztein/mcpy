/**
 * From what a company filed to its fiscal years. A filing repeats earlier
 * years' figures as comparatives and may restate them, so for one period the
 * latest filing's value wins, dated by the first filing that reported it.
 * Fiscal years are the 10-K periods of 350 to 380 days (52- and 53-week years
 * included); quarterly reports only ever supply the latest balance sheet.
 */

import type { FiledFact, FoundFundamentals, FundamentalMeasure } from "../../providers/stock-types.js";
import type { FiscalYear } from "../../schemas-stocks.js";

const DAY_MS = 86_400_000;
const FLOWS = ["revenue", "grossProfit", "operatingIncome", "netIncome", "epsDiluted", "operatingCashFlow", "capex"] as const;
const BALANCE = ["assets", "liabilities", "equity", "cash", "longTermDebt"] as const;
type Facts = FoundFundamentals["facts"];

const days = (f: FiledFact) => (f.start ? (Date.parse(f.end) - Date.parse(f.start)) / DAY_MS : 0);
export const isFiscalYear = (f: FiledFact) => f.annual && f.start !== undefined && days(f) >= 350 && days(f) <= 380;
const isInstant = (f: FiledFact) => f.start === undefined;

/** Among facts for one period: the latest filing's value, and the first filing that reported that value. */
export function settle(facts: readonly FiledFact[]): { value: number; filed: string } | undefined {
  if (!facts.length) return undefined;
  const latest = facts.reduce((a, b) => (b.filed > a.filed ? b : a));
  const filed = facts.filter((f) => f.value === latest.value).reduce((a, b) => (b.filed < a.filed ? b : a)).filed;
  return { value: latest.value, filed };
}

/** The settled value of `measure` for the period ending `end` among facts passing `keep`. */
function valueAt(facts: Facts, measure: FundamentalMeasure, end: string, keep: (f: FiledFact) => boolean) {
  return settle((facts[measure] ?? []).filter((f) => f.end === end && keep(f)));
}

/** The fiscal years' period ends, newest first. */
export function fiscalYearEnds(facts: Facts): string[] {
  const ends = new Set<string>();
  for (const m of ["revenue", "netIncome", "operatingIncome"] as const) for (const f of facts[m] ?? []) if (isFiscalYear(f)) ends.add(f.end);
  return [...ends].sort().reverse();
}

const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/** Up to `limit` fiscal years, newest first. */
export function fiscalYears(facts: Facts, limit: number): FiscalYear[] {
  return fiscalYearEnds(facts)
    .slice(0, limit)
    .map((end) => {
      const flow = (m: (typeof FLOWS)[number]) => valueAt(facts, m, end, isFiscalYear);
      // A 10-K's balance sheet is dated its year's last day; a later 10-K repeats it as a comparative.
      const instant = (m: (typeof BALANCE)[number]) => valueAt(facts, m, end, (f) => isInstant(f) && f.annual)?.value;
      const ocf = flow("operatingCashFlow")?.value;
      const capex = flow("capex")?.value;
      return compact({
        period_end: end,
        fiscal_year: Number(end.slice(0, 4)),
        revenue_usd: flow("revenue")?.value,
        gross_profit_usd: flow("grossProfit")?.value,
        operating_income_usd: flow("operatingIncome")?.value,
        net_income_usd: flow("netIncome")?.value,
        eps_diluted_usd: flow("epsDiluted")?.value,
        operating_cash_flow_usd: ocf,
        capex_usd: capex,
        free_cash_flow_usd: ocf !== undefined && capex !== undefined ? ocf - capex : undefined,
        assets_usd: instant("assets"),
        liabilities_usd: instant("liabilities"),
        equity_usd: instant("equity"),
        cash_usd: instant("cash"),
        long_term_debt_usd: instant("longTermDebt"),
        filed: (flow("netIncome") ?? flow("revenue"))?.filed,
      });
    });
}

/** The newest balance sheet filed, annual or quarterly, dated by its assets. */
export function latestBalanceSheet(facts: Facts) {
  const dates = (facts.assets ?? []).filter(isInstant).map((f) => f.end);
  if (!dates.length) return undefined;
  const asOf = dates.reduce((a, b) => (b > a ? b : a));
  const at = (m: (typeof BALANCE)[number]) => valueAt(facts, m, asOf, isInstant)?.value;
  return compact({ as_of: asOf, assets_usd: at("assets"), liabilities_usd: at("liabilities"), equity_usd: at("equity"), cash_usd: at("cash"), long_term_debt_usd: at("longTermDebt") });
}

/**
 * Common shares outstanding at the newest date filed. Should one filing state
 * several counts for the same date (one per share class), they are added up.
 */
export function sharesOutstanding(facts: Facts): { shares: number; asOf: string } | undefined {
  const counts = (facts.sharesOutstanding ?? []).filter(isInstant);
  if (!counts.length) return undefined;
  const asOf = counts.reduce((a, b) => (b.end > a.end ? b : a)).end;
  const atDate = counts.filter((f) => f.end === asOf);
  const filed = atDate.reduce((a, b) => (b.filed > a.filed ? b : a)).filed;
  return { shares: atDate.filter((f) => f.filed === filed).reduce((sum, f) => sum + f.value, 0), asOf };
}
