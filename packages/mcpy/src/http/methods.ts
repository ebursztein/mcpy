/**
 * What each HTTP method promises (RFC 9110 9.2). Safe methods only read: their
 * answers are cacheable by default and they carry no body. Idempotent methods
 * may be sent again after a lost connection; POST and PATCH may not.
 */

import { HttpMethod } from "../enums.js";

const SAFE: ReadonlySet<HttpMethod> = new Set([HttpMethod.Get, HttpMethod.Head]);
const NOT_IDEMPOTENT: ReadonlySet<HttpMethod> = new Set([HttpMethod.Post, HttpMethod.Patch]);

/** GET and HEAD (and no method, which is GET). */
export const isSafeMethod = (method: HttpMethod | undefined): boolean => method === undefined || SAFE.has(method);

/** Everything but POST and PATCH. */
export const isIdempotentMethod = (method: HttpMethod | undefined): boolean => method === undefined || !NOT_IDEMPOTENT.has(method);
