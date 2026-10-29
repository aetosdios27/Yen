import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CLAMAV_HOST", undefined);
  vi.stubEnv("EVIDENCE_STORAGE_DIR", undefined);
  vi.stubEnv("CLAMAV_PORT", undefined);
  vi.stubEnv("CLAMAV_TIMEOUT_MS", undefined);
  vi.stubEnv("CLAMAV_MAX_SIZE_BYTES", undefined);
  vi.stubEnv("PORT", undefined);
  vi.stubEnv("PARTNER_WEBHOOK_SECRET", undefined);
  vi.stubEnv("RATE_LIMIT_IP_CAPACITY", undefined);
  vi.stubEnv("RATE_LIMIT_PRINCIPAL_CAPACITY", undefined);
  vi.stubEnv("RATE_LIMIT_REFILL_MS", undefined);
  vi.stubEnv("TRUSTED_PROXY_HOPS", undefined);
  vi.stubEnv("TRUSTED_PROXY_HEADER", undefined);
  vi.stubEnv("CLEANUP_INTERVAL_MS", undefined);
  vi.stubEnv("DATABASE_POOL_MAX", undefined);
  vi.stubEnv("DATABASE_POOL_IDLE_TIMEOUT_SECONDS", undefined);
  vi.stubEnv("DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS", undefined);
  vi.stubEnv("CONCURRENCY_LIMIT", undefined);
  vi.stubEnv("REQUEST_TIMEOUT_MS", undefined);
  vi.stubEnv("SHUTDOWN_TIMEOUT_MS", undefined);
  vi.stubEnv("SERVER_HEADERS_TIMEOUT_MS", undefined);
  vi.stubEnv("SERVER_REQUEST_TIMEOUT_MS", undefined);
  vi.stubEnv("SERVER_KEEP_ALIVE_TIMEOUT_MS", undefined);
  vi.stubEnv("SERVER_MAX_HEADER_SIZE_BYTES", undefined);
});

afterEach(() => vi.unstubAllEnvs());

it("exports typed env and parses it only once per startup", async () => {
  vi.stubEnv("PORT", "3001");
  const { env } = await import("./env.js");
  expect(env).toMatchObject({
    NODE_ENV: "test",
    PORT: 3001,
    RATE_LIMIT_MAX_KEYS: 100000,
    RATE_LIMIT_IP_CAPACITY: 120,
    RATE_LIMIT_PRINCIPAL_CAPACITY: 60,
    RATE_LIMIT_REFILL_MS: 60000,
    TRUSTED_PROXY_HOPS: 0,
    TRUSTED_PROXY_HEADER: "x-forwarded-for",
    CLEANUP_INTERVAL_MS: 60000,
    DATABASE_POOL_MAX: 10,
    DATABASE_POOL_IDLE_TIMEOUT_SECONDS: 20,
    DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS: 10,
    CONCURRENCY_LIMIT: 100,
    REQUEST_TIMEOUT_MS: 15000,
    SHUTDOWN_TIMEOUT_MS: 10000,
    SERVER_HEADERS_TIMEOUT_MS: 20000,
    SERVER_REQUEST_TIMEOUT_MS: 15000,
    SERVER_KEEP_ALIVE_TIMEOUT_MS: 5000,
    SERVER_MAX_HEADER_SIZE_BYTES: 16384,
  });
  vi.stubEnv("PORT", "invalid");
  expect((await import("./env.js")).env).toBe(env);
});

it.each([undefined, "", "0", "65536", "3001.5", "invalid-private-value"])(
  "rejects missing or invalid PORT %s without exposing its value",
  async (port) => {
    vi.stubEnv("PORT", port);
    await expect(import("./env.js")).rejects.toThrow("PORT");
    await expect(import("./env.js")).rejects.not.toThrow("invalid-private-value");
  },
);

it("lists every invalid variable", async () => {
  vi.stubEnv("NODE_ENV", "invalid-private-value");
  await expect(import("./env.js")).rejects.toThrow(/NODE_ENV[\s\S]*PORT/);
  await expect(import("./env.js")).rejects.not.toThrow("invalid-private-value");
});

it("accepts configured rate limits", async () => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("RATE_LIMIT_IP_CAPACITY", "10");
  vi.stubEnv("RATE_LIMIT_PRINCIPAL_CAPACITY", "5");
  vi.stubEnv("RATE_LIMIT_REFILL_MS", "2000");
  const { env } = await import("./env.js");
  expect(env).toMatchObject({
    RATE_LIMIT_IP_CAPACITY: 10,
    RATE_LIMIT_PRINCIPAL_CAPACITY: 5,
    RATE_LIMIT_REFILL_MS: 2000,
  });
});

it.each(["0", "-1", "1.5", "Infinity", "private-value"])(
  "rejects invalid rate limits %s",
  async (value) => {
    vi.stubEnv("PORT", "3001");
    vi.stubEnv("RATE_LIMIT_IP_CAPACITY", value);
    await expect(import("./env.js")).rejects.toThrow("RATE_LIMIT_IP_CAPACITY");
    await expect(import("./env.js")).rejects.not.toThrow("private-value");
  },
);

it("requires a valid database URL in production", async () => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", undefined);
  await expect(import("./env.js")).rejects.toThrow("DATABASE_URL");
});

it("requires a ClamAV host in production", async () => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OTP_HASH_KEY", "test-production-secret-with-at-least-32-characters");
  vi.stubEnv("DATABASE_URL", "postgres://postgres:pw@localhost:55432/postgres");
  await expect(import("./env.js")).rejects.toThrow("CLAMAV_HOST");
});

it("requires an absolute evidence storage directory in production", async () => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OTP_HASH_KEY", "test-production-secret-with-at-least-32-characters");
  vi.stubEnv("CLAMAV_HOST", "clamav.internal");
  vi.stubEnv("DATABASE_URL", "postgres://postgres:pw@localhost:55432/postgres");
  await expect(import("./env.js")).rejects.toThrow("EVIDENCE_STORAGE_DIR");

  vi.resetModules();
  vi.stubEnv("EVIDENCE_STORAGE_DIR", "./relative-evidence");
  await expect(import("./env.js")).rejects.toThrow("absolute path");
});

it("accepts a PostgreSQL URL in production and rejects invalid URLs without exposing them", async () => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OTP_HASH_KEY", "test-production-secret-with-at-least-32-characters");
  vi.stubEnv("CLAMAV_HOST", "clamav.internal");
  vi.stubEnv("DATABASE_URL", "postgres://postgres:pw@localhost:55432/postgres");
  vi.stubEnv("EVIDENCE_STORAGE_DIR", "/var/lib/yen/evidence");
  expect((await import("./env.js")).env.DATABASE_URL).toBe(
    "postgres://postgres:pw@localhost:55432/postgres",
  );
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "private-invalid-value");
  await expect(import("./env.js")).rejects.toThrow("DATABASE_URL");
  await expect(import("./env.js")).rejects.not.toThrow("private-invalid-value");
});

it("requires a long OTP hash key in production", async () => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgres://postgres:pw@localhost:55432/postgres");
  vi.stubEnv("OTP_HASH_KEY", "short");
  await expect(import("./env.js")).rejects.toThrow("OTP_HASH_KEY");
  await expect(import("./env.js")).rejects.not.toThrow("short");
});

it("leaves the partner webhook secret unset by default and rejects short values without exposing them", async () => {
  vi.stubEnv("PORT", "3001");
  expect((await import("./env.js")).env.PARTNER_WEBHOOK_SECRET).toBeUndefined();
  vi.resetModules();
  vi.stubEnv("PARTNER_WEBHOOK_SECRET", "short-secret");
  await expect(import("./env.js")).rejects.toThrow("PARTNER_WEBHOOK_SECRET");
  await expect(import("./env.js")).rejects.not.toThrow("short-secret");
  vi.resetModules();
  const sampleSecret = "0".repeat(32);
  vi.stubEnv("PARTNER_WEBHOOK_SECRET", sampleSecret);
  expect((await import("./env.js")).env.PARTNER_WEBHOOK_SECRET).toBe(sampleSecret);
});

it.each([
  ["TRUSTED_PROXY_HOPS", "-1"],
  ["TRUSTED_PROXY_HOPS", "6"],
  ["TRUSTED_PROXY_HOPS", "1.5"],
  ["WAITLIST_MIN_RESPONSE_MS", "-1"],
  ["WAITLIST_MIN_RESPONSE_MS", "2001"],
  ["WAITLIST_MIN_RESPONSE_MS", "1.5"],
  ["DATABASE_POOL_MAX", "0"],
  ["DATABASE_POOL_MAX", "1001"],
  ["DATABASE_POOL_MAX", "1.5"],
  ["DATABASE_POOL_IDLE_TIMEOUT_SECONDS", "-1"],
  ["DATABASE_POOL_IDLE_TIMEOUT_SECONDS", "86401"],
  ["DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS", "0"],
  ["DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS", "301"],
  ["CONCURRENCY_LIMIT", "0"],
  ["CONCURRENCY_LIMIT", "10001"],
  ["REQUEST_TIMEOUT_MS", "99"],
  ["REQUEST_TIMEOUT_MS", "300001"],
  ["SHUTDOWN_TIMEOUT_MS", "99"],
  ["SHUTDOWN_TIMEOUT_MS", "60001"],
  ["SERVER_KEEP_ALIVE_TIMEOUT_MS", "-1"],
  ["SERVER_KEEP_ALIVE_TIMEOUT_MS", "60001"],
  ["SERVER_MAX_HEADER_SIZE_BYTES", "1023"],
  ["SERVER_MAX_HEADER_SIZE_BYTES", "1048577"],
])("rejects out of range %s=%s", async (key, value) => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv(key, value);
  await expect(import("./env.js")).rejects.toThrow(key);
});

it.each(["x-forwarded-for", "forwarded"])("accepts TRUSTED_PROXY_HEADER %s", async (value) => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("TRUSTED_PROXY_HEADER", value);
  expect((await import("./env.js")).env.TRUSTED_PROXY_HEADER).toBe(value);
});

it.each(["Forwarded", "x-real-ip", "x-forwarded-for,forwarded", ""])(
  "rejects unsupported TRUSTED_PROXY_HEADER %s without exposing its value",
  async (value) => {
    vi.stubEnv("PORT", "3001");
    vi.stubEnv("TRUSTED_PROXY_HEADER", value);
    await expect(import("./env.js")).rejects.toThrow("TRUSTED_PROXY_HEADER");
    await expect(import("./env.js")).rejects.not.toThrow("x-real-ip");
  },
);

it.each(["999", "3600001", "1.5", "invalid"])(
  "rejects out of range CLEANUP_INTERVAL_MS %s",
  async (value) => {
    vi.stubEnv("PORT", "3001");
    vi.stubEnv("CLEANUP_INTERVAL_MS", value);
    await expect(import("./env.js")).rejects.toThrow("CLEANUP_INTERVAL_MS");
  },
);

it("rejects SERVER_HEADERS_TIMEOUT_MS <= SERVER_KEEP_ALIVE_TIMEOUT_MS", async () => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("SERVER_KEEP_ALIVE_TIMEOUT_MS", "10000");
  vi.stubEnv("SERVER_HEADERS_TIMEOUT_MS", "10000");
  await expect(import("./env.js")).rejects.toThrow("SERVER_HEADERS_TIMEOUT_MS");
});

it.each(["999", "1000001", "1.5", "invalid"])(
  "rejects invalid rate limit key cap %s",
  async (value) => {
    vi.stubEnv("PORT", "3001");
    vi.stubEnv("RATE_LIMIT_MAX_KEYS", value);
    await expect(import("./env.js")).rejects.toThrow("RATE_LIMIT_MAX_KEYS");
  },
);

it.each(["-1", "60001", "1.5", "invalid"])("rejects invalid readiness cache %s", async (value) => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("READINESS_CACHE_MS", value);
  await expect(import("./env.js")).rejects.toThrow("READINESS_CACHE_MS");
});
