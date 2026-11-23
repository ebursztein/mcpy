/** Europe group c shopping sites. Add each new site to this list. */

import type { ShoppingSite } from "../../types.js";
import { advertsIe } from "./adverts-ie.js";
import { bazosCz, bazosSk } from "./bazos.js";
import { dubizzleAe } from "./dubizzle.js";
import { gumtree } from "./gumtree.js";
import { kupujemprodajem } from "./kupujemprodajem.js";
import { milanuncios } from "./milanuncios.js";
import { sahibinden } from "./sahibinden.js";
import { sbazar } from "./sbazar.js";
import { shpock } from "./shpock.js";
import { skelbiu } from "./skelbiu.js";
import { todocoleccion } from "./todocoleccion.js";
import { vintedFr } from "./vinted.js";
import { wallapop } from "./wallapop.js";

export const europeCSites: readonly ShoppingSite[] = [
  bazosCz,
  bazosSk,
  sbazar,
  todocoleccion,
  skelbiu,
  gumtree,
  kupujemprodajem,
  vintedFr,
  dubizzleAe,
  wallapop,
  milanuncios,
  shpock,
  advertsIe,
  sahibinden,
];
