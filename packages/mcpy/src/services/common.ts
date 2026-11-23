/**
 * Types every list service shares: ISO enums, money, timestamps, site reports.
 * Every categorical value is a z.enum; free strings only hold text a site wrote.
 */

import { z } from "zod";
import { enumOf } from "../enums.js";
import { COUNTRIES, CURRENCIES, LANGUAGES } from "./iso.js";

/** Agents send "UK" and "US": lowercase first, and take uk for gb. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = { uk: "gb" };
export const CountrySchema = z
  .preprocess((v) => (typeof v === "string" ? (COUNTRY_ALIASES[v.toLowerCase()] ?? v.toLowerCase()) : v), z.enum(COUNTRIES))
  .describe("Two-letter country code, e.g. us, gb, de, jp");
export type Country = (typeof COUNTRIES)[number];
export const isCountry = (v: string): v is Country => (COUNTRIES as readonly string[]).includes(v);

export const LanguageSchema = z
  .preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.enum(LANGUAGES))
  .describe("Two-letter language code, e.g. en, ja");
export type Language = (typeof LANGUAGES)[number];
export const isLanguage = (v: string): v is Language => (LANGUAGES as readonly string[]).includes(v);

export const CurrencySchema = z.enum(CURRENCIES);
export type Currency = (typeof CURRENCIES)[number];
export const isCurrency = (v: string): v is Currency => (CURRENCIES as readonly string[]).includes(v);

const siteStatus = enumOf({ Ok: "ok", Empty: "empty", Unsupported: "unsupported", Failed: "failed", OverBudget: "over_budget" } as const);
export const SiteStatus = siteStatus.values;
export const SiteStatusSchema = siteStatus.schema;
export type SiteStatus = z.infer<typeof SiteStatusSchema>;

/** A part of a request a site could not apply. Never names a vendor. */
const requestPart = enumOf({
  Sort: "sort",
  MinPrice: "min_price",
  MaxPrice: "max_price",
  Condition: "condition",
  CardCondition: "card_condition",
  Language: "language",
  Format: "format",
  Location: "location",
  Cursor: "cursor",
  Game: "game",
  SellerCountry: "seller_country",
  Seller: "seller",
  Category: "category",
  Attributes: "attributes",
  Facets: "facets",
} as const);
export const RequestPart = requestPart.values;
export const RequestPartSchema = requestPart.schema;
export type RequestPart = z.infer<typeof RequestPartSchema>;

/** Why a site did not return a result page. */
const siteFailure = enumOf({
  Blocked: "blocked",
  Redesigned: "redesigned",
  Redirected: "redirected",
  Truncated: "truncated",
  Timeout: "timeout",
  UpstreamFailed: "upstream_failed",
} as const);
export const SiteFailure = siteFailure.values;
export const SiteFailureSchema = siteFailure.schema;
export type SiteFailure = z.infer<typeof SiteFailureSchema>;

export const MAX_URL_CHARS = 4_096;
/** Room for a few sites' own page tokens: Wallapop's signed token alone is ~930 chars (2026-11-22). */
export const MAX_CURSOR_CHARS = 16_384;
/** One site's own next-page token, as carried inside next_cursor. */
export const MAX_SITE_TOKEN_CHARS = 2_000;
export const MAX_TEXT_CHARS = 1_200;

export const UrlSchema = z.url({ protocol: /^https?$/ }).max(MAX_URL_CHARS);
export const TimestampSchema = z.iso.datetime({ offset: true });
export const MoneySchema = z.object({ amount: z.number().nonnegative(), currency: CurrencySchema });
export type Money = z.infer<typeof MoneySchema>;
export const TextSchema = z.string().max(MAX_TEXT_CHARS);

/** A list of enum values with no repeats. */
export function enumSet<E extends z.ZodType<string>>(item: E, max: number) {
  return z
    .array(item)
    .min(1)
    .max(max)
    .refine((xs) => new Set(xs).size === xs.length, "no repeated values");
}
