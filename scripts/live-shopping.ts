/**
 * Live check of shopping sites through the real SDK path (engine, fallback
 * chain, render, readers, normalize). Direct fetches go from this machine;
 * Firecrawl and Bright Data are the paid fallbacks (keys in apps/server/.dev.vars).
 *
 *   npx tsx scripts/live-shopping.ts --sites yahoo_auctions,leboncoin [--query "black lotus"] [--game mtg] [--min 500] [--sort newest] [--out file.json]
 *
 * For each site: one named search, the same search newest-first with a price
 * floor, and a nonsense query that must come back empty, not failed.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createMcpy, MemoryCache, MARKETPLACES, type Marketplace } from "../packages/mcpy/src/index.js";
import { brightData, direct, firecrawl } from "../packages/mcpy/src/providers/index.js";

const DEV_VARS = new URL("../apps/server/.dev.vars", import.meta.url);
const keys: Record<string, string> = existsSync(DEV_VARS)
  ? Object.fromEntries(readFileSync(DEV_VARS, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]))
  : {};

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const sites = (arg("sites") ?? "").split(",").filter(Boolean) as Marketplace[];
for (const s of sites) if (!(MARKETPLACES as readonly string[]).includes(s)) throw new Error(`unknown site ${s}`);
const query = arg("query");
/** Trading-card game for card sites (pokemon, mtg, yugioh, one_piece, lorcana); unset: each site's main game. */
const game = arg("game");
const min = arg("min") ? Number(arg("min")) : undefined;
const modes = (arg("modes") ?? "named,floor,empty").split(",");

const pages = [direct(), ...(keys.FIRECRAWL_API_KEY ? [firecrawl({ apiKey: keys.FIRECRAWL_API_KEY })] : []), ...(keys.BRIGHTDATA_API_KEY && keys.BRIGHTDATA_UNLOCKER_ZONE ? [brightData({ apiKey: keys.BRIGHTDATA_API_KEY, zone: keys.BRIGHTDATA_UNLOCKER_ZONE })] : [])];
const mcpy = createMcpy({ cache: new MemoryCache(), pages });

/** A default query per site language, so every site gets a search with real results. */
const DEFAULT_QUERY: Partial<Record<string, string>> = { ja: "リザードン", ko: "리자몽" };

const report: Record<string, unknown>[] = [];
for (const site of sites) {
  const lang = site.startsWith("joongna") || site.startsWith("bunjang") || site.startsWith("daangn") ? "ko" : /yahoo|paypay|mercari|rakuma|cardrush|dorasuta|magi|surugaya|hareruya|yuyutei/.test(site) ? "ja" : "en";
  const named = query ?? DEFAULT_QUERY[lang] ?? "charizard";
  const runs: [string, Record<string, unknown>][] = [
    ["named", { query: named }],
    ["floor", { query: named, sort: "newest", min_price: min ?? (lang === "ja" || lang === "ko" ? 5000 : 50) }],
    ["empty", { query: "qzxjvwk glurak zzqv" }],
  ];
  for (const [mode, extra] of runs.filter(([m]) => modes.includes(m))) {
    const started = Date.now();
    try {
      const r = await mcpy.shopping({ marketplaces: [site], max_results: 60, max_products: 2, max_age: 0, ...(game ? { game } : {}), ...extra } as never);
      const rep = r.marketplaces[0]!;
      const first = r.results[0];
      const floorOk = mode === "floor" ? r.results.every((l) => !l.price || l.price.amount >= (extra.min_price as number)) : undefined;
      const line = { site, mode, status: rep.status, failure: rep.failure, error: rep.error, http: rep.http_status, results: rep.results, total: rep.total, ignored: rep.ignored, floorOk, ms: Date.now() - started, attempts: r.meta.attempts,
        priced: r.results.filter((l) => l.price).length, sample: first ? { id: first.id, title: first.title.slice(0, 60), price: first.price, url: first.url, posted_at: first.posted_at, card_condition: first.card_condition, seller: first.seller?.name } : undefined };
      report.push(line);
      console.log(JSON.stringify(line));
    } catch (err) {
      const line = { site, mode, status: "error", error: err instanceof Error ? err.message.slice(0, 200) : String(err), ms: Date.now() - started };
      report.push(line);
      console.log(JSON.stringify(line));
    }
  }
}
if (arg("out")) writeFileSync(arg("out")!, JSON.stringify(report, null, 2));
