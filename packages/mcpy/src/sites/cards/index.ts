/** Trading-card marketplaces and shops. Add each new site to this list. */

import type { ShoppingSite } from "../types.js";
import { cardkingdom } from "./cardkingdom.js";
import { cardmarket } from "./cardmarket.js";
import { cardrush } from "./cardrush.js";
import { cardtrader } from "./cardtrader.js";
import { coolstuffinc } from "./coolstuffinc.js";
import { dorasuta } from "./dorasuta.js";
import { hareruya } from "./hareruya.js";
import { magi } from "./magi.js";
import { starcitygames } from "./starcitygames.js";
import { surugaya } from "./surugaya.js";
import { tcgplayer } from "./tcgplayer.js";
import { yuyutei } from "./yuyutei.js";

export const cardSites: readonly ShoppingSite[] = [tcgplayer, cardmarket, cardtrader, cardkingdom, starcitygames, coolstuffinc, hareruya, yuyutei, cardrush, dorasuta, magi, surugaya];
