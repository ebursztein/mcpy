/**
 * Look one cache entry up by its full key, as a log's `mcpy.cache.key` shows
 * it. For operators (the server's admin-only /v1/admin/cache): the answer
 * names the provider that produced the entry.
 */
import { z } from "zod";
import { CACHE_VERSIONS, CacheNameSchema, type CacheName } from "./spaces.js";
import { CacheTierSchema, type LayeredCache } from "./layered.js";

/** Characters of the stored value's JSON returned at most. */
export const INSPECT_MAX_CHARS = 20_000;

export const CacheInspectionSchema = z.object({
  key: z.string(),
  /** The space and version the key names, when it names a known space. */
  name: CacheNameSchema.optional(),
  version: z.number().int().optional(),
  /** Whether that version is the one the code reads today (an older one is never read). */
  current: z.boolean(),
  found: z.boolean(),
  /** The layer that answered (memory | kv); this read also copies a KV entry into this isolate's memory. */
  tier: CacheTierSchema.optional(),
  /** Whether the stored value is a cache envelope (value, provider, write time). */
  envelope: z.boolean().optional(),
  provider: z.string().optional(),
  stored_at: z.string().optional(),
  age_s: z.number().int().optional(),
  /** Length of the stored value's JSON, and the first INSPECT_MAX_CHARS of it. */
  chars: z.number().int().optional(),
  value_json: z.string().optional(),
  truncated: z.boolean().optional(),
  /** The backend's error, when the read failed. */
  error: z.string().optional(),
});
export type CacheInspection = z.infer<typeof CacheInspectionSchema>;

const EnvelopeSchema = z.object({ value: z.unknown(), provider: z.string().optional(), storedAt: z.number().optional() });

/** The space and version a key names: `v<version>:<name>:<id>`, the longest known name winning (`crypto:coin` over nothing). */
export function parseCacheKey(key: string): { name: CacheName; version: number } | undefined {
  const m = /^v(\d+):(.+)$/.exec(key);
  if (!m) return undefined;
  const names = CacheNameSchema.options.filter((n) => m[2] === n || m[2].startsWith(`${n}:`));
  const name = names.sort((a, b) => b.length - a.length)[0];
  return name ? { name, version: Number(m[1]) } : undefined;
}

export async function inspectEntry(store: LayeredCache, key: string): Promise<CacheInspection> {
  const parsed = parseCacheKey(key);
  const head = { key, ...parsed, current: parsed !== undefined && CACHE_VERSIONS[parsed.name] === parsed.version };
  let found: Awaited<ReturnType<LayeredCache["read"]>>;
  try {
    found = await store.read(key, crypto.randomUUID()); // alone: never in another request's get
  } catch (err) {
    return CacheInspectionSchema.parse({ ...head, found: false, error: err instanceof Error ? err.message : String(err) });
  }
  if (!found) return CacheInspectionSchema.parse({ ...head, found: false });
  const envelope = EnvelopeSchema.safeParse(found.value);
  const stored = envelope.success ? envelope.data.value : found.value;
  const json = JSON.stringify(stored) ?? "";
  const storedAt = envelope.success ? envelope.data.storedAt : undefined;
  return CacheInspectionSchema.parse({
    ...head,
    found: true,
    tier: found.tier,
    envelope: envelope.success,
    provider: envelope.success ? envelope.data.provider : undefined,
    stored_at: storedAt === undefined ? undefined : new Date(storedAt).toISOString(),
    age_s: storedAt === undefined ? undefined : Math.round((Date.now() - storedAt) / 1000),
    chars: json.length,
    value_json: json.slice(0, INSPECT_MAX_CHARS),
    truncated: json.length > INSPECT_MAX_CHARS,
  });
}
