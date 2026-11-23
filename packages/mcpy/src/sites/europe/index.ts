/** European shopping sites, in three groups so each can be worked on alone. */

import type { ShoppingSite } from "../types.js";
import { europeASites } from "./a/index.js";
import { europeBSites } from "./b/index.js";
import { europeCSites } from "./c/index.js";

export const europeSites: readonly ShoppingSite[] = [...europeASites, ...europeBSites, ...europeCSites];
