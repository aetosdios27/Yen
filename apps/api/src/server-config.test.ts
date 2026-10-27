import { expect, it } from "vitest";
import { useMemoryStore } from "./server-config.js";

it("requires a database in production even if memory is requested", () => {
  expect(() => useMemoryStore({ NODE_ENV: "production", YEN_ALLOW_MEMORY_STORES: "true" })).toThrow(
    "YEN_ALLOW_MEMORY_STORES is forbidden in production",
  );
});

it("permits memory stores outside production when explicitly enabled", () => {
  expect(useMemoryStore({ NODE_ENV: "development", YEN_ALLOW_MEMORY_STORES: "true" })).toBe(true);
});

it("requires a database unless memory is explicitly enabled outside production", () => {
  expect(() =>
    useMemoryStore({ NODE_ENV: "development", YEN_ALLOW_MEMORY_STORES: "false" }),
  ).toThrow("DATABASE_URL");
});

it("applies Node HTTP server timeout and slow-client settings", async () => {
  const { startServer } = await import("./server-bootstrap.js");
  const customConfig = {
    NODE_ENV: "test" as const,
    PORT: 0,
    YEN_ALLOW_MEMORY_STORES: "true" as const,
    DATABASE_URL: undefined,
    READINESS_CACHE_MS: 1000,
    TRUSTED_PROXY_HOPS: 0,
    WAITLIST_MIN_RESPONSE_MS: 75,
    WAITLIST_RATE_LIMIT_CAPACITY: 5,
    WAITLIST_RATE_LIMIT_REFILL_MS: 3600000,
    WAITLIST_BODY_LIMIT_BYTES: 8192,
    RATE_LIMIT_MAX_KEYS: 100000,
    RATE_LIMIT_IP_CAPACITY: 120,
    RATE_LIMIT_PRINCIPAL_CAPACITY: 60,
    RATE_LIMIT_REFILL_MS: 60000,
    DATABASE_POOL_MAX: 10,
    DATABASE_POOL_IDLE_TIMEOUT_SECONDS: 20,
    DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS: 10,
    CONCURRENCY_LIMIT: 100,
    REQUEST_TIMEOUT_MS: 15000,
    SHUTDOWN_TIMEOUT_MS: 10000,
    SERVER_HEADERS_TIMEOUT_MS: 25000,
    SERVER_REQUEST_TIMEOUT_MS: 18000,
    SERVER_KEEP_ALIVE_TIMEOUT_MS: 6000,
    SERVER_MAX_HEADER_SIZE_BYTES: 32768,
  };
  const started = await startServer(customConfig, { registerSignals: false });
  try {
    expect(started.server.headersTimeout).toBe(25000);
    expect(started.server.requestTimeout).toBe(18000);
    expect(started.server.keepAliveTimeout).toBe(6000);
    expect((started.server as unknown as { maxHeaderSize?: number }).maxHeaderSize).toBe(32768);
  } finally {
    await started.lifecycle.shutdown();
  }
});
