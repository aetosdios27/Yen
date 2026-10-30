import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createSql, migrate, type Sql } from "@yen/db";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { createApp } from "./app.js";
import { createDatabaseReady } from "./database-ready.js";
import { DefaultInFlightTracker } from "./dependencies.js";
import { createServerLifecycle, shutdownOnSignal } from "./lifecycle.js";
import { type LogEntry, serializeRequestLog } from "./logging.js";
import { type ServerConfig, startServer } from "./server-bootstrap.js";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function waitForServer(url: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Condition was not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const silentLogger = { log: () => undefined };

function fakeHttpServer(): import("node:http").Server {
  return {
    close: (cb: () => void) => cb(),
    closeIdleConnections: () => {},
    closeAllConnections: () => {},
  } as unknown as import("node:http").Server;
}

describe("Admission control counts only admitted work", () => {
  it("reports unready if shutdown starts while a readiness check is pending", async () => {
    let shuttingDown = false;
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createApp({
      isShuttingDown: () => shuttingDown,
      readiness: async () => {
        await hold;
        return true;
      },
      logger: silentLogger,
    });
    const probe = app.request("/ready");
    await new Promise((resolve) => setTimeout(resolve, 10));
    shuttingDown = true;
    release();
    expect((await probe).status).toBe(503);
  });

  it("does not let pending health probes take concurrency slots from ordinary requests", async () => {
    let releaseReadiness: () => void = () => {};
    const readinessHold = new Promise<void>((resolve) => {
      releaseReadiness = resolve;
    });
    const app = createApp({
      concurrencyLimit: 1,
      readiness: async () => {
        await readinessHold;
        return true;
      },
      logger: silentLogger,
    });
    app.get("/ordinary", (c) => c.json({ ordinary: true }, 200));

    const pendingProbe = app.request("/ready");
    await new Promise((r) => setTimeout(r, 10));

    const ordinary = await app.request("/ordinary");
    expect(ordinary.status).toBe(200);

    releaseReadiness();
    expect((await pendingProbe).status).toBe(200);
  });

  it("releases rejected requests at once so admitted work is admitted again as soon as it completes", async () => {
    const inFlightTracker = new DefaultInFlightTracker();
    let releaseWork: () => void = () => {};
    const workHold = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });
    const app = createApp({
      concurrencyLimit: 2,
      inFlightTracker,
      // The waitlist response floor keeps each rejected waitlist request waiting for 1 s.
      waitlistMinResponseMs: 1000,
      logger: silentLogger,
    });
    app.get("/slow-work", async (c) => {
      await workHold;
      return c.json({ done: true }, 200);
    });
    app.get("/fast", (c) => c.json({ fast: true }, 200));

    const admitted = [app.request("/slow-work"), app.request("/slow-work")];
    await new Promise((r) => setTimeout(r, 10));

    const burst = Array.from({ length: 5 }, () =>
      app.request("/v1/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );

    releaseWork();
    await Promise.all(admitted);
    expect(inFlightTracker.count).toBe(0);

    const fast = await app.request("/fast");
    expect(fast.status).toBe(200);

    const rejected = await Promise.all(burst);
    for (const res of rejected) {
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("1");
    }
  });

  it("logs overload rejections as warnings with the overloaded reason and in-flight count, without request data", async () => {
    const entries: LogEntry[] = [];
    let releaseHeld: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    const app = createApp({
      concurrencyLimit: 1,
      logger: {
        log: (entry) => {
          entries.push(entry);
        },
      },
    });
    app.get("/held", async (c) => {
      await held;
      return c.json({ held: true }, 200);
    });

    const pending = app.request("/held");
    await new Promise((r) => setTimeout(r, 10));

    const personal = {
      name: "Asha Personal",
      contact: "asha.personal@example.com",
      org: "Private Org",
      locale: "en",
      consent: { accepted: true, text: "Yes", version: "1" },
    };
    const shed = await app.request("/v1/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(personal),
    });
    expect(shed.status).toBe(503);

    releaseHeld();
    expect((await pending).status).toBe(200);

    const overloads = entries.filter((entry) => entry.event === "http_overloaded");
    expect(overloads).toEqual([
      expect.objectContaining({
        level: "warn",
        reason: "overloaded",
        inFlight: 1,
        method: "POST",
      }),
    ]);
    expect(entries.filter((entry) => entry.event === "http_failure")).toEqual([]);

    const serialized = overloads.map((entry) => serializeRequestLog(entry)).join("\n");
    expect(serialized).not.toContain("Asha");
    expect(serialized).not.toContain("asha.personal@example.com");
    expect(serialized).not.toContain("Private Org");
  });
});

describe("Overload responses are readable by browsers", () => {
  it("gives 504 and 503 responses the CORS headers and exposes Retry-After", async () => {
    const origin = "https://app.yen.test";
    let releaseSlow: () => void = () => {};
    const slowHold = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const app = createApp({
      corsOrigins: [origin],
      concurrencyLimit: 1,
      requestTimeoutMs: 50,
      logger: silentLogger,
    });
    app.get("/slow", async (c) => {
      await slowHold;
      return c.json({ done: true }, 200);
    });

    const expectBrowsable = (res: Response) => {
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-expose-headers")).toContain("Retry-After");
    };

    try {
      const timedOut = await app.request("/slow", { headers: { Origin: origin } });
      expect(timedOut.status).toBe(504);
      expectBrowsable(timedOut);

      // The timed-out handler still holds the only slot, so the next request is shed.
      const shed = await app.request("/slow", { headers: { Origin: origin } });
      expect(shed.status).toBe(503);
      expect(shed.headers.get("retry-after")).toBe("1");
      expectBrowsable(shed);
    } finally {
      releaseSlow();
    }
  });
});

describe("Backpressure and load shedding", () => {
  it("under 5x baseline concurrency sheds with 503 Retry-After while keeping health checks responsive", async () => {
    const concurrencyLimit = 10;
    const inFlightTracker = new DefaultInFlightTracker();

    let releaseRequests: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });

    const app = createApp({
      concurrencyLimit,
      inFlightTracker,
      readiness: async () => true,
      logger: { log: () => undefined },
    });

    app.get("/slow-work", async (c) => {
      await hold;
      return c.json({ done: true }, 200);
    });

    const baseline = concurrencyLimit;
    const totalRequests = baseline * 5; // 5x concurrency = 50 requests

    const initialMemory = process.memoryUsage().heapUsed;

    // Send 50 concurrent requests
    const tasks = Array.from({ length: totalRequests }, () =>
      app.request("/slow-work", { method: "GET" }),
    );

    // Give microtasks time to register in middleware
    await new Promise((r) => setTimeout(r, 50));

    // While overloaded, probe the health, readiness and build identity routes.
    const healthRes = await app.request("/health");
    const readyRes = await app.request("/ready");
    const versionRes = await app.request("/version");
    expect(healthRes.status).toBe(200);
    expect(readyRes.status).toBe(200);
    expect(versionRes.status).toBe(200);

    // Release held requests
    releaseRequests();
    const responses = await Promise.all(tasks);

    const admitted = responses.filter((r) => r.status === 200);
    const shed = responses.filter((r) => r.status === 503);

    expect(admitted.length).toBe(concurrencyLimit);
    expect(shed.length).toBe(totalRequests - concurrencyLimit);

    for (const s of shed) {
      expect(s.headers.get("retry-after")).toBe("1");
      const body = await s.json();
      expect(body).toMatchObject({
        error: { code: "overloaded", message: "Service temporarily unavailable" },
      });
    }

    // Memory does not explode
    const finalMemory = process.memoryUsage().heapUsed;
    const growthMb = (finalMemory - initialMemory) / (1024 * 1024);
    expect(growthMb).toBeLessThan(50);
  });
});

describe("Per-request timeouts", () => {
  it("aborts requests exceeding the timeout and returns 504 gateway timeout error", async () => {
    const app = createApp({
      requestTimeoutMs: 100,
      logger: { log: () => undefined },
    });

    app.get("/hangs", async (c) => {
      await new Promise((r) => setTimeout(r, 400));
      return c.json({ done: true });
    });

    const start = Date.now();
    const res = await app.request("/hangs");
    const duration = Date.now() - start;

    expect(res.status).toBe(504);
    expect(duration).toBeLessThan(350);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: "gateway_timeout", message: "Gateway timeout" },
    });
  });

  it("returns 504 on timeout and holds in-flight count during shutdown drain until handler finishes", async () => {
    const inFlightTracker = new DefaultInFlightTracker();
    let finishHandler: () => void = () => {};
    const handlerHold = new Promise<void>((resolve) => {
      finishHandler = resolve;
    });

    const app = createApp({
      requestTimeoutMs: 50,
      inFlightTracker,
      logger: { log: () => undefined },
    });

    app.get("/slow-operation", async (c) => {
      await handlerHold;
      return c.json({ completed: true });
    });

    // 1. Request times out at 50ms and receives 504 Gateway Timeout
    const res = await app.request("/slow-operation");
    expect(res.status).toBe(504);

    // 2. Handler is still running; in-flight count must still be 1
    expect(inFlightTracker.count).toBe(1);

    // 3. Start shutdown drain; it must wait for the running handler
    let drainCompleted = false;
    const fakeServer = {
      close: (cb: () => void) => cb(),
      closeIdleConnections: () => {},
      closeAllConnections: () => {},
    } as unknown as import("node:http").Server;

    const lifecycle = createServerLifecycle({
      server: fakeServer,
      getInFlight: () => inFlightTracker.count,
      shutdownTimeoutMs: 2000,
      drainPollMs: 10,
    });

    const shutdownPromise = lifecycle.shutdown().then(() => {
      drainCompleted = true;
    });

    // Wait a few drain poll intervals (50ms); drain must NOT complete while handler runs
    await new Promise((r) => setTimeout(r, 50));
    expect(drainCompleted).toBe(false);
    expect(inFlightTracker.count).toBe(1);

    // 4. Now release the handler promise and wait for shutdown to finish
    finishHandler();
    await shutdownPromise;
    expect(drainCompleted).toBe(true);
    expect(inFlightTracker.count).toBe(0);
  });

  it("permits requests completing before the timeout", async () => {
    const app = createApp({
      requestTimeoutMs: 500,
      logger: { log: () => undefined },
    });

    app.get("/fast", (c) => c.json({ fast: true }, 200));
    const res = await app.request("/fast");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fast: true });
  });

  it("excludes health checks from request timeout", async () => {
    const app = createApp({
      requestTimeoutMs: 50,
      readiness: async () => {
        await new Promise((r) => setTimeout(r, 80));
        return true;
      },
      logger: { log: () => undefined },
    });

    const health = await app.request("/health");
    expect(health.status).toBe(200);
    const ready = await app.request("/ready");
    expect(ready.status).toBe(200);
    const version = await app.request("/version");
    expect(version.status).toBe(200);
  });
});

describe("Graceful shutdown lifecycle unit tests", () => {
  it("drains in-flight requests and closes pool", async () => {
    let inFlight = 2;
    const fakeServer = {
      close: (cb: () => void) => cb(),
      closeIdleConnections: () => {},
      closeAllConnections: () => {},
    } as unknown as import("node:http").Server;

    let poolClosed = false;
    const fakeSql = {
      end: async () => {
        poolClosed = true;
      },
    } as unknown as import("@yen/db").Sql;

    const lifecycle = createServerLifecycle({
      server: fakeServer,
      sql: fakeSql,
      getInFlight: () => inFlight,
      shutdownTimeoutMs: 2000,
      drainPollMs: 10,
    });

    setTimeout(() => {
      inFlight = 0;
    }, 50);

    await lifecycle.shutdown();
    expect(lifecycle.isShuttingDown).toBe(true);
    expect(poolClosed).toBe(true);
  });

  it("fails /ready with 503 as soon as shutdown starts while /health stays 200 and an in-flight request drains", async () => {
    const testConfig: ServerConfig = {
      NODE_ENV: "test",
      PORT: 0,
      YEN_ALLOW_MEMORY_STORES: "true",
      DATABASE_URL: undefined,
      READINESS_CACHE_MS: 1000,
      TRUSTED_PROXY_HOPS: 0,
      TRUSTED_PROXY_HEADER: "x-forwarded-for",
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
      SERVER_HEADERS_TIMEOUT_MS: 20000,
      SERVER_REQUEST_TIMEOUT_MS: 15000,
      SERVER_KEEP_ALIVE_TIMEOUT_MS: 5000,
      SERVER_MAX_HEADER_SIZE_BYTES: 16384,
    };

    // Real listening server. A held request keeps the drain open while shutdown is in progress.
    const started = await startServer(testConfig, { registerSignals: false });
    const base = `http://127.0.0.1:${started.port}`;
    let releaseHeld: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    started.app.get("/test-held", async (c) => {
      await held;
      return c.json({ held: true }, 200);
    });

    try {
      expect((await fetch(`${base}/ready`)).status).toBe(200);
      expect((await fetch(`${base}/health`)).status).toBe(200);

      const inFlight = fetch(`${base}/test-held`);
      await waitUntil(() => started.inFlightTracker.count === 1);

      const shutdown = started.lifecycle.shutdown();
      expect(started.lifecycle.isShuttingDown).toBe(true);

      // The server has stopped listening, so probe the same app in-process.
      const ready = await started.app.request("/ready");
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({
        error: { code: "internal", message: "Internal server error" },
      });

      const health = await started.app.request("/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ status: "ok" });

      // The drain still waits for the held request.
      expect(started.inFlightTracker.count).toBe(1);

      releaseHeld();
      expect((await inFlight).status).toBe(200);
      await shutdown;
      expect(started.inFlightTracker.count).toBe(0);
    } finally {
      releaseHeld();
      if (!started.lifecycle.isShuttingDown) {
        await started.lifecycle.shutdown();
      }
    }
  });
});

describe("Failed shutdown cleanup is reported", () => {
  const failingSql = {
    end: async () => {
      throw new Error("postgres://app:hunter2@db.internal:5432/yen refused");
    },
  } as unknown as Sql;

  const failingLifecycle = () =>
    createServerLifecycle({
      server: fakeHttpServer(),
      sql: failingSql,
      getInFlight: () => 0,
      shutdownTimeoutMs: 1000,
      drainPollMs: 10,
    });

  it("rejects shutdown when closing the database pool fails", async () => {
    await expect(failingLifecycle().shutdown()).rejects.toThrow("Database pool failed to close");
  });

  it("reports the failure on stderr and exits 1 without printing connection details", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exit = vi.fn();
    try {
      await shutdownOnSignal(failingLifecycle(), "SIGTERM", exit);
      expect(exit).toHaveBeenCalledWith(1);
      expect(exit).toHaveBeenCalledTimes(1);
      const output = write.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Error during SIGTERM shutdown: Database pool failed to close\n");
      expect(output).not.toContain("hunter2");
    } finally {
      write.mockRestore();
    }
  });

  it("exits 0 when cleanup succeeds", async () => {
    const exit = vi.fn();
    const lifecycle = createServerLifecycle({
      server: fakeHttpServer(),
      getInFlight: () => 0,
      shutdownTimeoutMs: 1000,
      drainPollMs: 10,
    });
    await shutdownOnSignal(lifecycle, "SIGINT", exit);
    expect(exit).toHaveBeenCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

databaseSuite("Database failure and recovery", (adminSql, adminUrl) => {
  it("turns /ready red within timeout when Postgres backends are terminated and recovers without restart", async () => {
    const testDbName = `yen_test_ready_${randomUUID().replaceAll("-", "")}`;
    const probeRole = `probe_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

    // Set up dedicated test database with a non-superuser probe role
    await adminSql`CREATE ROLE ${adminSql(probeRole)} LOGIN PASSWORD 'pw'`;
    await adminSql`CREATE DATABASE ${adminSql(testDbName)} OWNER postgres`;
    await adminSql`REVOKE CONNECT ON DATABASE ${adminSql(testDbName)} FROM PUBLIC`;
    await adminSql`GRANT CONNECT ON DATABASE ${adminSql(testDbName)} TO ${adminSql(probeRole)}`;

    const adminDbUrl = new URL(adminUrl);
    adminDbUrl.pathname = `/${testDbName}`;
    const dbAdminSql = createSql(adminDbUrl.toString());
    try {
      await migrate(dbAdminSql);
      await dbAdminSql`GRANT USAGE ON SCHEMA public TO ${dbAdminSql(probeRole)}`;
      await dbAdminSql`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${dbAdminSql(probeRole)}`;
    } finally {
      await dbAdminSql.end({ timeout: 2 });
    }

    const probeDbUrl = new URL(adminUrl);
    probeDbUrl.username = probeRole;
    probeDbUrl.password = "pw";
    probeDbUrl.pathname = `/${testDbName}`;

    const readiness = createDatabaseReady(
      () => createSql(probeDbUrl.toString(), { max: 1, connectTimeout: 1, idleTimeout: 1 }),
      { cacheMs: 0 },
    );
    const app = createApp({ readiness, logger: { log: () => undefined } });

    try {
      // 1. Initial healthy state
      expect((await app.request("/ready")).status).toBe(200);
      expect((await app.request("/health")).status).toBe(200);

      // 2. Kill Postgres: terminate backends and revoke connect privilege
      await adminSql`REVOKE CONNECT ON DATABASE ${adminSql(testDbName)} FROM ${adminSql(probeRole)}`;
      await adminSql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${testDbName} AND pid <> pg_backend_pid()`;

      // 3. /ready turns red within the timeout
      const start = Date.now();
      const readyDuringDown = await app.request("/ready");
      const elapsed = Date.now() - start;

      expect(readyDuringDown.status).toBe(503);
      expect(elapsed).toBeLessThan(2500);

      // /health remains dependency-free and 200 OK
      expect((await app.request("/health")).status).toBe(200);

      // 4. Restore Postgres: grant connect back
      await adminSql`GRANT CONNECT ON DATABASE ${adminSql(testDbName)} TO ${adminSql(probeRole)}`;

      // 5. /ready recovers without process restart
      expect((await app.request("/ready")).status).toBe(200);
    } finally {
      await adminSql`DROP DATABASE IF EXISTS ${adminSql(testDbName)} WITH (FORCE)`;
      await adminSql`DROP ROLE IF EXISTS ${adminSql(probeRole)}`;
    }
  }, 15000);
});

databaseSuite("SIGTERM during load", (sql, url) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  it("drops zero in-flight requests and refuses new connections after SIGTERM", async () => {
    const port = await getFreePort();
    const serverUrl = `http://127.0.0.1:${port}`;
    const loader = fileURLToPath(import.meta.resolve("tsx"));
    const serverPath = fileURLToPath(new URL("./server.ts", import.meta.url));
    const apiDir = fileURLToPath(new URL("..", import.meta.url));

    // Spawn the real server as a child process
    const child = spawn("node", ["--import", loader, serverPath], {
      cwd: apiDir,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: url,
        PAYEE_FINGERPRINT_SALT: "x".repeat(32),
        WAITLIST_MIN_RESPONSE_MS: "350",
        SHUTDOWN_TIMEOUT_MS: "5000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let childExited = false;
    let exitCode: number | null = null;
    child.on("exit", (code) => {
      childExited = true;
      exitCode = code;
    });

    try {
      await waitForServer(serverUrl, 10000);

      // Send 5 concurrent in-flight requests that take at least 350ms
      const inFlightRequests = Array.from({ length: 5 }, (_, i) =>
        fetch(`${serverUrl}/v1/waitlist`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: `Load User ${i}`,
            contact: `sigterm_${i}@example.com`,
            org: "Community",
            locale: "en",
            consent: { accepted: true, text: "Yes", version: "1" },
          }),
        }),
      );

      // Wait 50ms so requests are in-flight
      await new Promise((r) => setTimeout(r, 50));

      // Send SIGTERM to the real server child process
      child.kill("SIGTERM");

      // Give Node server.close() 50ms to stop accepting new connections
      await new Promise((r) => setTimeout(r, 50));

      // Attempt new connection after SIGTERM - must be refused or closed
      let newConnectionRefused = false;
      try {
        const newReq = await fetch(`${serverUrl}/health`);
        if (!newReq.ok) newConnectionRefused = true;
      } catch {
        newConnectionRefused = true;
      }
      expect(newConnectionRefused).toBe(true);

      // Assert every in-flight request completed successfully with 201 (0 dropped)
      const responses = await Promise.all(inFlightRequests);
      for (const res of responses) {
        expect(res.status).toBe(201);
      }

      // Assert child exits with code 0
      const exitDeadline = Date.now() + 5000;
      while (!childExited && Date.now() < exitDeadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(childExited).toBe(true);
      expect(exitCode).toBe(0);
    } finally {
      if (!childExited) {
        child.kill("SIGKILL");
      }
    }
  }, 20000);
});
