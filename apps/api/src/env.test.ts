import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PORT", undefined);
  vi.stubEnv("RATE_LIMIT_IP_CAPACITY", undefined);
  vi.stubEnv("RATE_LIMIT_PRINCIPAL_CAPACITY", undefined);
  vi.stubEnv("RATE_LIMIT_REFILL_MS", undefined);
});

afterEach(() => vi.unstubAllEnvs());

it("exports typed env and parses it only once per startup", async () => {
  vi.stubEnv("PORT", "3001");
  const { env } = await import("./env.js");
  expect(env).toMatchObject({
    NODE_ENV: "test",
    PORT: 3001,
    RATE_LIMIT_IP_CAPACITY: 120,
    RATE_LIMIT_PRINCIPAL_CAPACITY: 60,
    RATE_LIMIT_REFILL_MS: 60000,
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

it("accepts a PostgreSQL URL in production and rejects invalid URLs without exposing them", async () => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgres://postgres:pw@localhost:55432/postgres");
  expect((await import("./env.js")).env.DATABASE_URL).toBe(
    "postgres://postgres:pw@localhost:55432/postgres",
  );
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "private-invalid-value");
  await expect(import("./env.js")).rejects.toThrow("DATABASE_URL");
  await expect(import("./env.js")).rejects.not.toThrow("private-invalid-value");
});

it.each([
  ["TRUSTED_PROXY_HOPS", "-1"],
  ["TRUSTED_PROXY_HOPS", "6"],
  ["TRUSTED_PROXY_HOPS", "1.5"],
  ["WAITLIST_MIN_RESPONSE_MS", "-1"],
  ["WAITLIST_MIN_RESPONSE_MS", "2001"],
  ["WAITLIST_MIN_RESPONSE_MS", "1.5"],
])("rejects out of range %s=%s", async (key, value) => {
  vi.stubEnv("PORT", "3001");
  vi.stubEnv(key, value);
  await expect(import("./env.js")).rejects.toThrow(key);
});
