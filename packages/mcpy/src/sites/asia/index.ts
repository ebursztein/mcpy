/** Japan and Korea shopping sites. Add each new site to this list. */

import type { ShoppingSite } from "../types.js";
import { bunjang } from "./bunjang.js";
import { daangn } from "./daangn.js";
import { joongna } from "./joongna.js";
import { mercariJp } from "./mercari.js";
import { paypayFlea } from "./paypay-flea.js";
import { rakuma } from "./rakuma.js";
import { yahooAuctions } from "./yahoo-auctions.js";

export const asiaSites: readonly ShoppingSite[] = [yahooAuctions, paypayFlea, mercariJp, rakuma, joongna, bunjang, daangn];
