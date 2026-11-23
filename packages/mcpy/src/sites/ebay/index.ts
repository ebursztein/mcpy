/** eBay stores: every eBay site in one search (ebay), and one per country site (ebay_us ... ebay_es). */

import type { ShoppingSite } from "../types.js";
import { ebayWorldwide } from "./browse.js";
import { ebaySiteList } from "./ebay.js";

export const ebaySites: readonly ShoppingSite[] = [ebayWorldwide, ...ebaySiteList];
