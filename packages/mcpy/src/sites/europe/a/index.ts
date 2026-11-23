/** Europe group a shopping sites. Add each new site to this list. */

import type { ShoppingSite } from "../../types.js";
import { catawiki } from "./catawiki.js";
import { leboncoin } from "./leboncoin.js";
import { marktplaats, tweedehands } from "./marktplaats.js";
import { olxSites } from "./olx.js";
import { ricardo } from "./ricardo.js";
import { subito } from "./subito.js";
import { anibis, tutti } from "./tutti.js";
import { willhaben } from "./willhaben.js";

export const europeASites: readonly ShoppingSite[] = [leboncoin, subito, marktplaats, tweedehands, willhaben, ricardo, tutti, anibis, catawiki, ...olxSites];
