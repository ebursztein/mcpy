import { LogLevel, UserAgentProfile } from "mcpy";
import { ProviderId } from "mcpy/providers";
import { describe, expect, it } from "vitest";
import { ConfigError, loadEnv, type Env } from "../../src/env.js";

/** loadEnv's error for `env`, or a failure if it parses. */
function configError(env: Env): ConfigError {
  try {
    loadEnv(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err as ConfigError;
  }
  throw new Error("expected a ConfigError");
}

describe("loadEnv defaults", () => {
  it("fills every setting when the env is empty", () => {
    const config = loadEnv({});
    expect(config.PAGE_PROVIDERS).toEqual([ProviderId.Direct, ProviderId.CloudflareBrowser, ProviderId.Firecrawl, ProviderId.BrightData]);
    expect(config.SEARCH_PROVIDERS).toEqual([ProviderId.Firecrawl, ProviderId.BrightData]);
    expect(config.ATTEMPT_TIMEOUT_MS).toBe(20_000);
    expect(config.DEADLINE_MS).toBe(45_000);
    expect(config.MAX_RESPONSE_BYTES).toBe(5_000_000);
    expect(config.PAGE_CACHE_TTL_SECONDS).toBe(3_600);
    expect(config.SEARCH_CACHE_TTL_SECONDS).toBe(900);
    expect(config.RETRIES).toBe(2);
    expect(config.LOG_LEVEL).toBe(LogLevel.Info);
    expect(config.DEFAULT_USER_AGENT).toBe(UserAgentProfile.Default);
    expect(config.OTEL_SERVICE_NAME).toBe("mcpy");
    expect(config.DEPLOYMENT_ENV).toBe("production");
    expect(config.ALLOW_ANONYMOUS).toBe(false);
    expect(config.ALLOWED_HOSTNAMES).toEqual([]);
    expect(config.OTEL_EXPORTER_OTLP_HEADERS).toEqual({});
    expect(config.FIRECRAWL_API_KEY).toBeUndefined();
  });

  it("accepts explicit values", () => {
    const config = loadEnv({
      LOG_LEVEL: LogLevel.Debug,
      DEFAULT_USER_AGENT: UserAgentProfile.Chrome,
      RETRIES: "0",
      DEADLINE_MS: "60000",
      ALLOW_ANONYMOUS: "true",
    });
    expect(config.LOG_LEVEL).toBe(LogLevel.Debug);
    expect(config.DEFAULT_USER_AGENT).toBe(UserAgentProfile.Chrome);
    expect(config.RETRIES).toBe(0);
    expect(config.DEADLINE_MS).toBe(60_000);
    expect(config.ALLOW_ANONYMOUS).toBe(true);
  });
});

describe("csv vars", () => {
  it("trims spaces and drops empty entries", () => {
    const config = loadEnv({ PAGE_PROVIDERS: " firecrawl , direct,, ", ALLOWED_HOSTNAMES: "a.example , b.example" });
    expect(config.PAGE_PROVIDERS).toEqual([ProviderId.Firecrawl, ProviderId.Direct]);
    expect(config.ALLOWED_HOSTNAMES).toEqual(["a.example", "b.example"]);
  });

  it("falls back to the default list when only separators are given", () => {
    expect(loadEnv({ SEARCH_PROVIDERS: " , " }).SEARCH_PROVIDERS).toEqual([ProviderId.Firecrawl, ProviderId.BrightData]);
  });

  it("rejects an unknown provider id, naming PAGE_PROVIDERS", () => {
    const err = configError({ PAGE_PROVIDERS: "direct,nope" });
    expect(err.message).toContain("PAGE_PROVIDERS");
    expect(err.issues.some((i) => i.startsWith("PAGE_PROVIDERS"))).toBe(true);
  });

  it("rejects an unknown search provider, naming SEARCH_PROVIDERS", () => {
    expect(configError({ SEARCH_PROVIDERS: "google" }).message).toContain("SEARCH_PROVIDERS");
  });
});

describe("integer vars", () => {
  it.each([
    ["RETRIES", "6"],
    ["RETRIES", "-1"],
    ["ATTEMPT_TIMEOUT_MS", "999"],
    ["DEADLINE_MS", "600001"],
    ["MAX_RESPONSE_BYTES", "9999"],
    ["PAGE_CACHE_TTL_SECONDS", "59"],
    ["SEARCH_CACHE_TTL_SECONDS", String(30 * 86_400 + 1)],
    ["RETRIES", "1.5"],
    ["RETRIES", "two"],
  ])("%s=%s is a ConfigError naming the var", (name, value) => {
    expect(configError({ [name]: value }).message).toContain(name);
  });

  it("accepts the bounds themselves", () => {
    const config = loadEnv({ RETRIES: "5", ATTEMPT_TIMEOUT_MS: "1000", PAGE_CACHE_TTL_SECONDS: "60" });
    expect([config.RETRIES, config.ATTEMPT_TIMEOUT_MS, config.PAGE_CACHE_TTL_SECONDS]).toEqual([5, 1_000, 60]);
  });
});

describe("other validation", () => {
  it("rejects a bad LOG_LEVEL, user agent, boolean or URL", () => {
    expect(configError({ LOG_LEVEL: "verbose" }).message).toContain("LOG_LEVEL");
    expect(configError({ DEFAULT_USER_AGENT: "netscape" }).message).toContain("DEFAULT_USER_AGENT");
    expect(configError({ ALLOW_ANONYMOUS: "yes" }).message).toContain("ALLOW_ANONYMOUS");
    expect(configError({ OTEL_EXPORTER_OTLP_ENDPOINT: "not a url" }).message).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
  });
});

describe("OTEL_EXPORTER_OTLP_HEADERS", () => {
  it("parses key=value pairs and URL-decodes them", () => {
    const config = loadEnv({ OTEL_EXPORTER_OTLP_HEADERS: "a=b,Authorization=Bearer%20x" });
    expect(config.OTEL_EXPORTER_OTLP_HEADERS).toEqual({ a: "b", Authorization: "Bearer x" });
  });

  it("trims spaces and skips malformed pairs", () => {
    const config = loadEnv({ OTEL_EXPORTER_OTLP_HEADERS: " x-team = ops , novalue, =orphan" });
    expect(config.OTEL_EXPORTER_OTLP_HEADERS).toEqual({ "x-team": "ops" });
  });

  // Regression (fixed): apps/server/src/env.ts:47 splits each pair on every "=", so a value
  // containing "=" (base64 padding, e.g. Grafana Cloud's
  // "Authorization=Basic%20dXNlcjpwYXNz==") has kv.length > 2 and the header is
  // silently dropped. The W3C baggage format OTel uses allows "=" in values;
  // split on the first "=" only.
  it("keeps values that contain '=' (base64 padding)", () => {
    const config = loadEnv({ OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic%20dXNlcjpwYXNz==" });
    expect(config.OTEL_EXPORTER_OTLP_HEADERS).toEqual({ Authorization: "Basic dXNlcjpwYXNz==" });
  });
});

describe("empty strings and memoization", () => {
  it("treats empty-string vars as unset", () => {
    const config = loadEnv({
      PAGE_PROVIDERS: "",
      RETRIES: "",
      LOG_LEVEL: "",
      FIRECRAWL_API_KEY: "",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
      DEFAULT_USER_AGENT: "",
    });
    expect(config.PAGE_PROVIDERS).toHaveLength(4);
    expect(config.RETRIES).toBe(2);
    expect(config.LOG_LEVEL).toBe(LogLevel.Info);
    expect(config.FIRECRAWL_API_KEY).toBeUndefined();
    expect(config.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(config.DEFAULT_USER_AGENT).toBe(UserAgentProfile.Default);
  });

  it("ignores bindings and other non-string values", () => {
    const config = loadEnv({ CACHE: { get: async () => null, put: async () => undefined }, RETRIES: 3 as unknown as string });
    expect(config.RETRIES).toBe(2);
  });

  it("parses once per env object", () => {
    const env: Env = { RETRIES: "1" };
    const first = loadEnv(env);
    env.RETRIES = "4";
    expect(loadEnv(env)).toBe(first);
    expect(loadEnv(env).RETRIES).toBe(1);
    expect(loadEnv({ RETRIES: "4" }).RETRIES).toBe(4);
  });

  it("does not memoize failures", () => {
    const env: Env = { RETRIES: "99" };
    expect(() => loadEnv(env)).toThrow(ConfigError);
    env.RETRIES = "1";
    expect(loadEnv(env).RETRIES).toBe(1);
  });
});
