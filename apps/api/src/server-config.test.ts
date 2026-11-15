import { expect, it } from "vitest";
import { useMemoryStore } from "./server-config.js";

it("requires a database in production even if memory is requested", () => {
  expect(() => useMemoryStore({ NODE_ENV: "production", YEN_ALLOW_MEMORY_STORES: "true" })).toThrow(
    "YEN_ALLOW_MEMORY_STORES is forbidden in production",
  );
});

it("fails closed when production delivery providers are missing", async () => {
  const { validateProductionDeliveryConfig } = await import("./server-bootstrap.js");
  expect(() =>
    validateProductionDeliveryConfig({ NODE_ENV: "production", DELIVERY_PROVIDER: "stub" }),
  ).toThrow("Production requires explicitly configured external delivery providers");
  expect(() =>
    validateProductionDeliveryConfig({ NODE_ENV: "production", DELIVERY_PROVIDER: "external" }),
  ).toThrow("WHATSAPP_API_BASE_URL");
});

it("allows the local web origin only for explicit development", async () => {
  const { resolveCorsOrigins } = await import("./server-bootstrap.js");
  const base = { PORT: 3001, NODE_ENV: "development" } as Parameters<typeof resolveCorsOrigins>[0];
  expect(resolveCorsOrigins(base, true)).toEqual([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
  expect(resolveCorsOrigins({ ...base, WEB_PORT: 3100 }, true)).toEqual([
    "http://localhost:3100",
    "http://127.0.0.1:3100",
  ]);
  expect(resolveCorsOrigins(base, false)).toEqual([]);
  expect(resolveCorsOrigins({ ...base, NODE_ENV: "production" }, false)).toEqual([]);
});

it("takes explicit CORS origins in any environment", async () => {
  const { resolveCorsOrigins } = await import("./server-bootstrap.js");
  const config = {
    PORT: 3001,
    NODE_ENV: "production",
    CORS_ORIGINS: "https://app.yen.example, https://yen.example",
  } as Parameters<typeof resolveCorsOrigins>[0];
  expect(resolveCorsOrigins(config, false)).toEqual([
    "https://app.yen.example",
    "https://yen.example",
  ]);
});

it("treats development as explicit only when NODE_ENV is literally set", async () => {
  const { isExplicitDevelopment } = await import("./server-bootstrap.js");
  const config = (NODE_ENV: "development" | "test" | "production") =>
    ({ PORT: 3001, NODE_ENV }) as Parameters<typeof isExplicitDevelopment>[1];
  expect(isExplicitDevelopment({ NODE_ENV: "development" }, config("development"))).toBe(true);
  expect(isExplicitDevelopment({}, config("development"))).toBe(false);
  expect(isExplicitDevelopment({ NODE_ENV: "production" }, config("development"))).toBe(false);
  expect(isExplicitDevelopment({ NODE_ENV: "development" }, config("production"))).toBe(false);
  expect(isExplicitDevelopment({ NODE_ENV: "test" }, config("test"))).toBe(false);
});

it("shortens the objection window only in explicit development", async () => {
  const { resolveObjectionWindowOverride } = await import("./server-bootstrap.js");
  expect(resolveObjectionWindowOverride({ OBJECTION_WINDOW_SECONDS: "5" }, true)).toBe(5);
  expect(resolveObjectionWindowOverride({ OBJECTION_WINDOW_SECONDS: "172800" }, true)).toBe(172800);
  expect(resolveObjectionWindowOverride({}, true)).toBeUndefined();
  expect(resolveObjectionWindowOverride({ OBJECTION_WINDOW_SECONDS: "" }, true)).toBeUndefined();
});

it.each([
  ["NODE_ENV unset", undefined],
  ["NODE_ENV=test", "test"],
  ["NODE_ENV=production", "production"],
])("ignores the objection window override with %s", async (_label, nodeEnv) => {
  const { isExplicitDevelopment, resolveObjectionWindowOverride } = await import(
    "./server-bootstrap.js"
  );
  const processEnv: NodeJS.ProcessEnv = { OBJECTION_WINDOW_SECONDS: "5" };
  if (nodeEnv !== undefined) processEnv.NODE_ENV = nodeEnv;
  const config = { PORT: 3001, NODE_ENV: nodeEnv ?? "development" } as Parameters<
    typeof isExplicitDevelopment
  >[1];
  expect(
    resolveObjectionWindowOverride(processEnv, isExplicitDevelopment(processEnv, config)),
  ).toBeUndefined();
});

it.each(["0", "-5", "1.5", "5s", "abc", "0x10", "172801", "99999999999999999999"])(
  "rejects objection window override %s in development",
  async (value) => {
    const { resolveObjectionWindowOverride } = await import("./server-bootstrap.js");
    expect(() => resolveObjectionWindowOverride({ OBJECTION_WINDOW_SECONDS: value }, true)).toThrow(
      "OBJECTION_WINDOW_SECONDS",
    );
  },
);

it("does not read an invalid override outside explicit development", async () => {
  const { resolveObjectionWindowOverride } = await import("./server-bootstrap.js");
  expect(
    resolveObjectionWindowOverride({ OBJECTION_WINDOW_SECONDS: "abc" }, false),
  ).toBeUndefined();
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

it("never returns a simulated OTP code from a server that did not opt in", async () => {
  const { startServer } = await import("./server-bootstrap.js");
  const started = await startServer(
    {
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
    },
    { registerSignals: false },
  );
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/v1/auth/otp/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "sms" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("simulatedDelivery");
  } finally {
    await started.lifecycle.shutdown();
  }
});
