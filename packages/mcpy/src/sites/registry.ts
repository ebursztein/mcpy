/**
 * Every shopping site by key. Each region folder exports its sites; a test
 * checks that every Marketplace key has exactly one reader.
 */

import type { Marketplace } from "../services/shopping/marketplace.js";
import { americasSites } from "./americas/index.js";
import { asiaSites } from "./asia/index.js";
import { cardSites } from "./cards/index.js";
import { ebaySites } from "./ebay/index.js";
import { europeSites } from "./europe/index.js";
import type { ShoppingSite } from "./types.js";

export const ALL_SITES: readonly ShoppingSite[] = [...ebaySites, ...cardSites, ...europeSites, ...asiaSites, ...americasSites];

export const SITES: Readonly<Partial<Record<Marketplace, ShoppingSite>>> = Object.fromEntries(ALL_SITES.map((s) => [s.key, s]));
