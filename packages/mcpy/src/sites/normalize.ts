/**
 * Site rows -> public listings. A row must be a listing on the site's own
 * host(s), with a listing id and a title; anything else is not a listing and
 * is never repaired. Each other field is kept only if it validates: one odd
 * field drops that field, never the row.
 */

import { isCountry, isCurrency, isLanguage, MoneySchema, TimestampSchema, UrlSchema, type Currency } from "../services/common.js";
import { ListingSchema, MAX_SEARCH_DETAILS, type Listing } from "../services/shopping/schema.js";
import { amount, count, str, timestamp } from "./readers/values.js";
import type { RawListing, ShoppingSite } from "./types.js";

/** Query parameters that only track the click. */
const TRACKING = /^(utm_|fbclid$|gclid$|_trksid$|_trkparms$|hash$|amdata$|mkcid$|mkrid$|campid$|toolid$|customid$|ref$|ref_$|source$|spm$|scm$)/i;

export function onSiteHost(site: ShoppingSite, host: string): boolean {
  if (host === site.host) return true;
  const extra = site.listingHosts;
  if (!extra) return false;
  return extra instanceof RegExp ? extra.test(host) : extra.includes(host);
}

/** The canonical listing URL: https, on the site, no credentials, port, fragment or tracking parameters. */
export function canonicalUrl(site: ShoppingSite, raw: string, base: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return undefined;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password || url.port || !onSiteHost(site, url.hostname)) return undefined;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  return url;
}

/** Symbols that name one currency; "$" and "¥" only confirm the site's own dollar or yen. */
const SYMBOLS: Readonly<Record<string, string>> = { "€": "EUR", "£": "GBP", "₩": "KRW", zł: "PLN", "₺": "TRY", "R$": "BRL", "CHF": "CHF" };

/** The stated currency as an ISO code; the site's own when none is stated; undefined when one is stated that we cannot name. */
function currencyOf(stated: string | null | undefined, fallback: Currency): Currency | undefined {
  const raw = (stated ?? "").trim();
  if (!raw) return fallback;
  const code = raw.toUpperCase();
  if (isCurrency(code)) return code;
  const symbol = SYMBOLS[raw];
  if (symbol && isCurrency(symbol)) return symbol;
  if ((raw === "$" && fallback.endsWith("D")) || ((raw === "¥" || raw === "円") && (fallback === "JPY" || fallback === "CNY"))) return fallback;
  return undefined;
}

function money(value: unknown, currency: string | null | undefined, fallback: Currency): Listing["price"] {
  const n = amount(value);
  const code = currencyOf(currency, fallback);
  if (n === undefined || code === undefined) return undefined;
  const parsed = MoneySchema.safeParse({ amount: n, currency: code });
  return parsed.success ? parsed.data : undefined;
}

function freeShipping(value: unknown): boolean {
  return typeof value === "string" && /free|gratuit|gratis|kostenlos|送料無料|무료|grátis|gratuita|included/i.test(value) && amount(value) === undefined;
}

export function absoluteUrl(value: unknown, base: string): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const u = new URL(value.startsWith("//") ? `https:${value}` : value, base);
    if (u.protocol === "http:") u.protocol = "https:";
    return UrlSchema.safeParse(u.href).success ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function details(raw: RawListing["details"]): Listing["details"] {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_SEARCH_DETAILS) break;
    const key = str(k, 50);
    const value = typeof v === "boolean" ? (v ? "yes" : "no") : str(v, 200);
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** One row -> a listing, or undefined when the row is not a listing on this site. */
export function normalize(site: ShoppingSite, row: RawListing, pageUrl: string): Listing | undefined {
  const title = str(row.title, 500);
  if (!row.url || !title) return undefined;
  const link = canonicalUrl(site, row.url, pageUrl);
  if (!link) return undefined;
  const id = str(row.id, 200) ?? site.listingId(link);
  if (!id) return undefined;
  const currency = site.currency;
  const price = money(row.price, row.currency, currency);
  const shipping = freeShipping(row.shipping) ? { amount: 0, currency: price?.currency ?? currency } : money(row.shipping, row.shippingCurrency ?? row.currency, currency);
  const bids = count(row.bids);
  const endsAt = timestamp(row.endsAt);
  const buyNow = money(row.buyNow, row.currency, currency);
  const auction = bids !== undefined || endsAt || buyNow ? { bids, ends_at: endsAt, buy_now: buyNow } : undefined;
  const postedAt = timestamp(row.postedAt);
  const lang = typeof row.language === "string" ? row.language.toLowerCase() : undefined;
  const country = typeof row.country === "string" ? row.country.toLowerCase() : undefined;
  const productUrl = row.product ? absoluteUrl(row.product.url, pageUrl) : undefined;
  const candidate: Record<string, unknown> = {
    marketplace: site.key,
    id,
    url: link.href,
    title,
    title_original: str(row.titleOriginal, 500),
    description: str(row.description, 1_200),
    price,
    format: row.format ?? undefined,
    auction,
    shipping,
    condition: row.condition ?? undefined,
    card_condition: row.cardCondition ?? undefined,
    language: lang && isLanguage(lang) ? lang : undefined,
    quantity: count(row.quantity) || undefined,
    product: row.product && productUrl ? { id: row.product.id, url: productUrl, title: str(row.product.title, 500) } : undefined,
    status: row.status ?? undefined,
    posted_at: postedAt && TimestampSchema.safeParse(postedAt).success ? postedAt : undefined,
    posted_text: postedAt ? undefined : str(row.postedText, 50),
    location: str(row.location, 200),
    country: country && isCountry(country) ? country : undefined,
    seller: str(row.seller, 200)
      ? { name: str(row.seller, 200), feedback_count: count(row.sellerFeedbackCount), feedback_percent: percent(row.sellerFeedbackPercent) }
      : undefined,
    promoted: typeof row.promoted === "boolean" ? row.promoted : undefined,
    image: absoluteUrl(row.image, pageUrl),
    details: details(row.details),
  };
  return keepValid(candidate);
}

function percent(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[%\s]/g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
}

/** Parse; on failure drop each invalid top-level field (never id, url, title, marketplace) and retry. */
function keepValid(candidate: Record<string, unknown>): Listing | undefined {
  for (let i = 0; i < 4; i++) {
    for (const k of Object.keys(candidate)) if (candidate[k] === undefined) delete candidate[k];
    const parsed = ListingSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    const bad = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    if (["marketplace", "id", "url", "title"].some((k) => bad.has(k))) return undefined;
    for (const k of bad) delete candidate[k];
  }
  return undefined;
}
