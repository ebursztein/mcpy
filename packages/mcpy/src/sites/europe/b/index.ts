/** Europe group b shopping sites. Add each new site to this list. */

import type { ShoppingSite } from "../../types.js";
import { allegroLokalnie } from "./allegro-lokalnie.js";
import { aukro } from "./aukro.js";
import { jofogas } from "./jofogas.js";
import { kleinanzeigen } from "./kleinanzeigen.js";
import { locantoDe, locantoEs, locantoFr, locantoGb, locantoIt } from "./locanto.js";
import { bolha, njuskalo } from "./njuskalo-bolha.js";
import { blocket, dba, finn, tori } from "./nordic.js";

export const europeBSites: readonly ShoppingSite[] = [
  allegroLokalnie,
  blocket,
  finn,
  dba,
  tori,
  aukro,
  jofogas,
  njuskalo,
  bolha,
  locantoDe,
  locantoFr,
  locantoIt,
  locantoEs,
  locantoGb,
  kleinanzeigen,
];
