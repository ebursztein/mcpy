/**
 * title_match: whether a row's title states the query. Some sites match a
 * query loosely (any one word, words in the description, n-grams): live on
 * 2026-11-23, "black lotus" on Leboncoin, Milanuncios and Wallapop returned
 * Lotus cars, watches and "Black Month" car ads, and "リザードン 初版" on
 * Rakuma returned One Piece cards. Those rows are dropped on the title alone.
 *
 * Text is compared folded: NFKC, lower case, Latin accents dropped (kana
 * voicing kept), punctuation as spaces. A word in a script written without
 * spaces (Japanese, Chinese, Korean) may sit anywhere in the title; any other
 * word must stand on its own, so "10" does not match "100".
 */

import type { ShoppingSite } from "../../sites/types.js";
import { TitleMatch, type TitleMatch as Mode } from "./schema.js";

const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function fold(s: string): string {
  return s
    .normalize("NFKD")
    // Latin accents only: kana voicing marks (ド = ト + U+3099) are letters' identity.
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The mode a site gets: auto filters only the sites that match loosely. */
export function titleMatchFor(mode: Mode, site: ShoppingSite): Mode {
  if (mode !== TitleMatch.Auto) return mode;
  return site.matchesLoosely ? TitleMatch.AllWords : TitleMatch.Any;
}

const contains = (haystack: string, needle: string) => (UNSPACED.test(needle) ? haystack.includes(needle) : ` ${haystack} `.includes(` ${needle} `));

/** A test for titles under `mode`; undefined when nothing is filtered. */
export function titleMatcher(query: string, mode: Mode): ((title: string) => boolean) | undefined {
  const q = fold(query);
  if (!q || mode === TitleMatch.Any || mode === TitleMatch.Auto) return undefined;
  if (mode === TitleMatch.Phrase) return (title) => contains(fold(title), q);
  const words = q.split(" ");
  return (title) => {
    const t = fold(title);
    return words.every((w) => contains(t, w));
  };
}
