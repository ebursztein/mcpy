/**
 * Card grades and printed languages as card sites state them, mapped onto
 * the public scales. Each site names its own scale; nothing is guessed from
 * a label a table does not list.
 *
 * Cardmarket's seven steps are the reference (MT NM EX GD LP PL PO). The US
 * five-step scale (NM, LP/SP, MP, HP, DMG) maps NM -> near_mint,
 * LP -> excellent, MP -> light_played, HP -> played, DMG -> poor.
 */

import { CardCondition } from "../../services/shopping/schema.js";

/** Cardmarket's abbreviations. */
export const CARDMARKET_GRADES: Readonly<Record<string, CardCondition>> = {
  MT: CardCondition.Mint,
  NM: CardCondition.NearMint,
  EX: CardCondition.Excellent,
  GD: CardCondition.Good,
  LP: CardCondition.LightPlayed,
  PL: CardCondition.Played,
  PO: CardCondition.Poor,
};

/** The US scale in words and abbreviations (TCGplayer, CardTrader, Hareruya, Star City Games). */
const US_GRADES: Readonly<Record<string, CardCondition>> = {
  mint: CardCondition.Mint,
  "near mint": CardCondition.NearMint,
  nm: CardCondition.NearMint,
  "lightly played": CardCondition.Excellent,
  "slightly played": CardCondition.Excellent,
  lp: CardCondition.Excellent,
  sp: CardCondition.Excellent,
  "moderately played": CardCondition.LightPlayed,
  mp: CardCondition.LightPlayed,
  played: CardCondition.Played,
  "heavily played": CardCondition.Played,
  hp: CardCondition.Played,
  damaged: CardCondition.Poor,
  dmg: CardCondition.Poor,
  poor: CardCondition.Poor,
};

/** A US-scale grade from its words or abbreviation ("Lightly Played Foil" reads as Lightly Played). */
export function usGrade(label: string | undefined): CardCondition | undefined {
  if (!label) return undefined;
  const key = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (US_GRADES[key]) return US_GRADES[key];
  const prefix = Object.keys(US_GRADES).find((k) => k.includes(" ") && key.startsWith(k));
  return prefix ? US_GRADES[prefix] : undefined;
}

/** English language names as card sites print them -> ISO 639-1. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  english: "en",
  french: "fr",
  german: "de",
  italian: "it",
  spanish: "es",
  portuguese: "pt",
  japanese: "ja",
  korean: "ko",
  russian: "ru",
  "s-chinese": "zh",
  "t-chinese": "zh",
  "chinese (s)": "zh",
  "chinese (t)": "zh",
  "simplified chinese": "zh",
  "traditional chinese": "zh",
  chinese: "zh",
  dutch: "nl",
  polish: "pl",
  thai: "th",
  indonesian: "id",
};

/** Site language codes that are not ISO 639-1 (jp, kr, zh-CN) -> ISO 639-1. */
const LANGUAGE_CODES: Readonly<Record<string, string>> = { jp: "ja", kr: "ko", "zh-cn": "zh", "zh-tw": "zh", "zh-hk": "zh" };

export function languageCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase().trim();
  if (LANGUAGE_NAMES[v]) return LANGUAGE_NAMES[v];
  if (LANGUAGE_CODES[v]) return LANGUAGE_CODES[v];
  return /^[a-z]{2}$/.test(v) ? v : undefined;
}

/** English country names as sellers' locations are printed -> ISO 3166-1 alpha-2 (Cardmarket's sellers). */
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  austria: "at",
  belgium: "be",
  bulgaria: "bg",
  canada: "ca",
  croatia: "hr",
  cyprus: "cy",
  "czech republic": "cz",
  czechia: "cz",
  denmark: "dk",
  estonia: "ee",
  finland: "fi",
  france: "fr",
  germany: "de",
  greece: "gr",
  hungary: "hu",
  iceland: "is",
  ireland: "ie",
  italy: "it",
  japan: "jp",
  latvia: "lv",
  liechtenstein: "li",
  lithuania: "lt",
  luxembourg: "lu",
  malta: "mt",
  netherlands: "nl",
  norway: "no",
  poland: "pl",
  portugal: "pt",
  romania: "ro",
  singapore: "sg",
  slovakia: "sk",
  slovenia: "si",
  spain: "es",
  sweden: "se",
  switzerland: "ch",
  "united kingdom": "gb",
  "united states": "us",
};

export const countryCode = (name: string | undefined): string | undefined => (name ? COUNTRY_NAMES[name.toLowerCase().trim()] : undefined);
