import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";
import type { Settings } from "./types.ts";

// Use ~/.mcpy/ for data -- works in both dev and compiled binary
const DATA_DIR = join(homedir(), ".mcpy");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

export { DATA_DIR };

const DEFAULT_SETTINGS: Settings = {
  apiKeys: {},
  database: {},
  tools: {},
};

let cached: Settings | null = null;

function ensureDataDir(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;

  ensureDataDir();

  const file = Bun.file(SETTINGS_FILE);
  let settings: Settings;

  if (await file.exists()) {
    try {
      settings = await file.json();
    } catch {
      settings = structuredClone(DEFAULT_SETTINGS);
    }
  } else {
    settings = structuredClone(DEFAULT_SETTINGS);
  }

  // Env var fallbacks
  if (!settings.apiKeys) settings.apiKeys = {};
  if (!settings.database) settings.database = {};
  if (!settings.tools) settings.tools = {};

  if (!settings.apiKeys.perplexity && process.env.PERPLEXITY_API_KEY) {
    settings.apiKeys.perplexity = process.env.PERPLEXITY_API_KEY;
  }

  cached = settings;
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  ensureDataDir();
  await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  cached = settings;
}

export async function updateSettings(
  partial: Record<string, unknown>
): Promise<Settings> {
  const current = await loadSettings();

  // Deep merge, but skip redacted values ("***")
  if (partial.apiKeys && typeof partial.apiKeys === "object") {
    const keys = partial.apiKeys as Record<string, string>;
    for (const [k, v] of Object.entries(keys)) {
      if (v && v !== "***") {
        (current.apiKeys as Record<string, string>)[k] = v;
      }
    }
  }

  if (partial.database && typeof partial.database === "object") {
    const dbs = partial.database as Record<string, Record<string, unknown>>;
    for (const [dbName, dbConfig] of Object.entries(dbs)) {
      if (dbConfig && typeof dbConfig === "object") {
        const existing =
          (current.database as Record<string, Record<string, unknown>>)[
            dbName
          ] || {};
        for (const [field, value] of Object.entries(dbConfig)) {
          if (value !== "***") {
            existing[field] = value;
          }
        }
        (current.database as Record<string, Record<string, unknown>>)[
          dbName
        ] = existing;
      }
    }
  }

  if (partial.tools && typeof partial.tools === "object") {
    Object.assign(current.tools, partial.tools);
  }

  await saveSettings(current);
  return current;
}

export function redactSettings(settings: Settings): Record<string, unknown> {
  const redacted = structuredClone(settings) as Record<string, unknown>;
  const apiKeys = redacted.apiKeys as Record<string, string> | undefined;
  if (apiKeys) {
    for (const key of Object.keys(apiKeys)) {
      if (apiKeys[key]) {
        const val = apiKeys[key];
        apiKeys[key] = val.length > 4 ? "***" + val.slice(-4) : "***";
      }
    }
  }

  const database = redacted.database as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (database) {
    for (const dbConfig of Object.values(database)) {
      if (dbConfig && typeof dbConfig === "object" && dbConfig.password) {
        dbConfig.password = "***";
      }
    }
  }

  return redacted;
}

export function getSettingValue(
  settings: Settings,
  path: string
): unknown {
  const parts = path.split(".");
  let current: unknown = settings;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
