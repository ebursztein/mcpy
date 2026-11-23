/** eBay shopping sites, one per domain (ebay_us, ebay_uk, ebay_de, ebay_fr, ebay_it, ebay_es). */

import type { ShoppingSite } from "../types.js";
import { ebaySiteList } from "./ebay.js";

export const ebaySites: readonly ShoppingSite[] = ebaySiteList;
