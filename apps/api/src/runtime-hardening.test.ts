import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createSql, migrate } from "@yen/db";
import { beforeAll, describe, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { createApp } from "./app.js";
import { createDatabaseReady } from "./database-ready.js";
import { DefaultInFlightTracker } from "./dependencies.js";
import { createServerLifecycle } from "./lifecycle.js";

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

    // While overloaded, probe /health and /ready - they MUST NOT be shed
    const healthRes = await app.request("/health");
    const readyRes = await app.request("/ready");
    expect(healthRes.status).toBe(200);
    expect(readyRes.status).toBe(200);

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
  it("aborts requests exceeding the timeout and returns 500 internal error", async () => {
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

    expect(res.status).toBe(500);
    expect(duration).toBeLessThan(350);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: "internal", message: "Internal server error" },
    });
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
