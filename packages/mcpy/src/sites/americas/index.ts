/** Latin America shopping sites: OLX Brasil and MercadoLibre / MercadoLivre. */

import type { ShoppingSite } from "../types.js";
import { mercadoLibreSites } from "./mercadolibre.js";
import { olxBr } from "./olx-br.js";

export const americasSites: readonly ShoppingSite[] = [olxBr, ...mercadoLibreSites];
