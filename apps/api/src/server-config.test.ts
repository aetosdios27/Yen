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
    TRUSTED_PROXY_HEADER: "x-forwarded-for" as const,
    CLEANUP_INTERVAL_MS: 60000,
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

it("isolates rate-limit buckets for different forwarded client IPs when trusted proxy hops are enabled", async () => {
  const { startServer } = await import("./server-bootstrap.js");
  const baseConfig = {
    NODE_ENV: "test" as const,
    PORT: 0,
    YEN_ALLOW_MEMORY_STORES: "true" as const,
    DATABASE_URL: undefined,
    READINESS_CACHE_MS: 1000,
    WAITLIST_MIN_RESPONSE_MS: 75,
    WAITLIST_RATE_LIMIT_CAPACITY: 5,
    WAITLIST_RATE_LIMIT_REFILL_MS: 3600000,
    WAITLIST_BODY_LIMIT_BYTES: 8192,
    RATE_LIMIT_MAX_KEYS: 100000,
    RATE_LIMIT_IP_CAPACITY: 1,
    RATE_LIMIT_PRINCIPAL_CAPACITY: 60,
    RATE_LIMIT_REFILL_MS: 60000,
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
    CLEANUP_INTERVAL_MS: 60000,
  };

  // 1. With TRUSTED_PROXY_HOPS=1 and configured header (forwarded), two different forwarded client IPs get separate buckets
  const proxyServer = await startServer(
    {
      ...baseConfig,
      TRUSTED_PROXY_HOPS: 1,
      TRUSTED_PROXY_HEADER: "forwarded",
    },
    { registerSignals: false },
  );

  try {
    const url = `http://127.0.0.1:${proxyServer.port}/v1/rate-limit-test`;

    // Client 1: first request uses the 1 available token and returns 404 (route not found, but admitted)
    const res1 = await fetch(url, { headers: { forwarded: "for=198.51.100.1" } });
    expect(res1.status).toBe(404);

    // Client 1: second request exceeds capacity and is rate-limited (429)
    const res2 = await fetch(url, { headers: { forwarded: "for=198.51.100.1" } });
    expect(res2.status).toBe(429);

    // Client 2: different forwarded client address has its own bucket, so its first request succeeds (404)
    const res3 = await fetch(url, { headers: { forwarded: "for=198.51.100.2" } });
    expect(res3.status).toBe(404);
  } finally {
    await proxyServer.lifecycle.shutdown();
  }

  // 2. With TRUSTED_PROXY_HOPS=0, forged forwarded headers are ignored and all requests share the socket bucket
  const directServer = await startServer(
    {
      ...baseConfig,
      TRUSTED_PROXY_HOPS: 0,
      TRUSTED_PROXY_HEADER: "forwarded",
    },
    { registerSignals: false },
  );

  try {
    const url = `http://127.0.0.1:${directServer.port}/v1/rate-limit-test`;

    // Client 1: consumes the 1 available token for the direct socket address
    const res1 = await fetch(url, { headers: { forwarded: "for=198.51.100.1" } });
    expect(res1.status).toBe(404);

    // Client 2: sends a different forged forwarded IP, but with 0 hops it is ignored and hits the exhausted socket bucket
    const res2 = await fetch(url, { headers: { forwarded: "for=198.51.100.2" } });
    expect(res2.status).toBe(429);
  } finally {
    await directServer.lifecycle.shutdown();
  }
});
