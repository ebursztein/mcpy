/** Failure outcomes shared by the europe-b readers. */

import { SiteFailure } from "../../../services/common.js";
import type { ReadOutcome } from "../../types.js";

export const blocked = (detail: string): ReadOutcome => ({ kind: "failed", failure: SiteFailure.Blocked, detail });
export const redesigned = (detail: string): ReadOutcome => ({ kind: "failed", failure: SiteFailure.Redesigned, detail });
