import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { migrate } from "@yen/db";
import { beforeAll, describe, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { createApp, devPolicy } from "./app.js";
import { clientIp } from "./client-ip.js";
import { PostgresIdempotencyStore, PostgresRateLimitStore } from "./stores.js";

const execFileAsync = promisify(execFile);
const workerPath = fileURLToPath(new URL("./test-worker.ts", import.meta.url));

databaseSuite("Shared stores across API instances", (sql, url) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  describe("Idempotency across instances", () => {
    it("two API instances against one database never run the same idempotency key twice", async () => {
      const store1 = new PostgresIdempotencyStore(sql);
      const store2 = new PostgresIdempotencyStore(sql);

      let fundCreationCount = 0;
      const principal = { id: "00000000-0000-4000-8000-000000000001" };

      const makeApp = (store: PostgresIdempotencyStore) =>
        createApp({
          idempotencyStore: store,
          rateLimitStore: new PostgresRateLimitStore(sql),
          principal,
          policy: devPolicy,
          logger: { log: () => {} },
          clientIp: () => "127.0.0.1",
          idGenerator: () => {
            fundCreationCount++;
            return "00000000-0000-4000-8000-000000000002";
          },
        });

      const app1 = makeApp(store1);
      const app2 = makeApp(store2);

      const idempotencyKey = `shared-instance-key-${Date.now()}`;
      const payload = {
        method: "POST" as const,
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-request-id": "00000000-0000-4000-8000-000000000099",
        },
        body: JSON.stringify({
          name: "Concurrent Fund",
          targetPaise: "5000",
          upiVpa: "club@upi",
          upiPayeeName: "Concurrent Club",
        }),
      };

      // Fire concurrent requests to two distinct app instances
      const [res1, res2] = await Promise.all([
        app1.request("/v1/funds", payload),
        app2.request("/v1/funds", payload),
      ]);

      const statuses = [res1.status, res2.status].sort();
      if (statuses[0] === 201 && statuses[1] === 201) {
        // One ran first, the other replayed the completed response
        const replays = [
          res1.headers.get("idempotent-replayed"),
          res2.headers.get("idempotent-replayed"),
        ];
        expect(replays).toContain("true");
        expect(replays).toContain(null);
      } else {
        // One acquired reservation, the other overlapped while in progress
        expect(statuses).toEqual([201, 409]);
        const conflictRes = res1.status === 409 ? res1 : res2;
        expect(conflictRes.headers.get("retry-after")).toBe("1");
      }

      const successRes =
        res1.status === 201 && res1.headers.get("idempotent-replayed") === null ? res1 : res2;
      const originalBody = await successRes.json();
      expect(originalBody).toMatchObject({ name: "Concurrent Fund" });

      // Handler strictly ran once across both instances
      expect(fundCreationCount).toBe(1);

      // Subsequent retry on either instance returns the replayed response without re-executing
      const retryRes = await app2.request("/v1/funds", payload);
      expect(retryRes.status).toBe(201);
      expect(retryRes.headers.get("idempotent-replayed")).toBe("true");
      expect(await retryRes.json()).toEqual(originalBody);

      // Still executed strictly once
      expect(fundCreationCount).toBe(1);
    });

    it("two separate OS processes running against one database run an idempotency key once", async () => {
      const idempotencyKey = `two-process-key-${Date.now()}`;
      const principalId = "00000000-0000-4000-8000-000000000010";
      const sharedName = "Shared Cross-Process Fund";

      // Launch two distinct child processes at the same moment with the same request payload
      const runWorker = () =>
        execFileAsync(process.execPath, [
          "--import",
          "tsx",
          workerPath,
          url,
          idempotencyKey,
          principalId,
          sharedName,
        ]);

      const [p1, p2] = await Promise.all([runWorker(), runWorker()]);

      const out1 = JSON.parse(p1.stdout.trim());
      const out2 = JSON.parse(p2.stdout.trim());

      // Verify they ran in distinct OS processes
      expect(out1.pid).not.toBe(out2.pid);

      const statuses = [out1.status, out2.status].sort();
      if (statuses[0] === 201 && statuses[1] === 201) {
        // One ran newly, the other replayed
        const replays = [out1.replayed, out2.replayed];
        expect(replays).toContain("true");
        expect(replays).toContain(null);
      } else {
        expect(statuses).toEqual([201, 409]);
        const loser = out1.status === 409 ? out1 : out2;
        expect(loser.retryAfter).toBe("1");
      }

      const winner = out1.status === 201 && out1.replayed === null ? out1 : out2;

      // Launch a third child process with the same idempotency key; it gets the replayed response
      const p3 = await runWorker();
      const out3 = JSON.parse(p3.stdout.trim());

      expect(out3.pid).not.toBe(winner.pid);
      expect(out3.status).toBe(201);
      expect(out3.replayed).toBe("true");
      expect(out3.body).toEqual(winner.body);

      // Verify exactly one row was created in Postgres
      const rows = await sql`
        SELECT key, response FROM idempotency_keys
        WHERE key = ${JSON.stringify([principalId, idempotencyKey])}
      `;
      expect(rows).toHaveLength(1);
      const parsed =
        typeof rows[0]?.response === "string" ? JSON.parse(rows[0].response) : rows[0]?.response;
      expect(parsed).toMatchObject({ status: 201 });
    });
  });

  describe("Per-IP rate limiting across instances", () => {
    it("the per-IP limit holds across instances", async () => {
      const rateLimitStore = new PostgresRateLimitStore(sql);

      let simulatedIp = "203.0.113.100";
      const principal = { id: "00000000-0000-4000-8000-000000000020" };

      const makeApp = () =>
        createApp({
          idempotencyStore: new PostgresIdempotencyStore(sql),
          rateLimitStore,
          principal,
          policy: devPolicy,
          logger: { log: () => {} },
          clientIp: () => simulatedIp,
          rateLimits: {
            ip: { capacity: 2, refillMs: 60_000 },
            principal: { capacity: 100, refillMs: 60_000 },
          },
        });

      const app1 = makeApp();
      const app2 = makeApp();

      // Request 1 to app1 from IP
      const r1 = await app1.request("/v1/me");
      expect(r1.status).toBe(200);

      // Request 2 to app2 from SAME IP (capacity 2 is now exhausted)
      const r2 = await app2.request("/v1/me");
      expect(r2.status).toBe(200);

      // Request 3 to app1 from SAME IP -> rejected with 429 across instances
      const r3 = await app1.request("/v1/me");
      expect(r3.status).toBe(429);
      expect(r3.headers.get("retry-after")).toBeDefined();

      // Request 4 to app2 from SAME IP -> also rejected with 429
      const r4 = await app2.request("/v1/me");
      expect(r4.status).toBe(429);

      // A different IP is isolated and still allowed on both instances
      simulatedIp = "203.0.113.101";
      expect((await app1.request("/v1/me")).status).toBe(200);
      expect((await app2.request("/v1/me")).status).toBe(200);
    });

    it("migrates waitlist rate limit to the shared store across instances", async () => {
      const rateLimitStore = new PostgresRateLimitStore(sql);
      const simulatedIp = "203.0.113.150";

      const makeApp = () =>
        createApp({
          waitlistStore: { add: async () => "created" as const },
          rateLimitStore,
          logger: { log: () => {} },
          waitlistMinResponseMs: 0,
          clientIp: () => simulatedIp,
          waitlistLimit: { capacity: 2, refillMs: 3_600_000 },
        });

      const app1 = makeApp();
      const app2 = makeApp();

      const postBody = {
        method: "POST" as const,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Tester",
          contact: "tester@example.com",
          org: "Yen",
          locale: "en",
          consent: { accepted: true, text: "I agree", version: "1" },
        }),
      };

      // First request on instance 1
      expect((await app1.request("/v1/waitlist", postBody)).status).toBe(201);

      // Second request on instance 2 -> capacity exhausted
      expect((await app2.request("/v1/waitlist", postBody)).status).toBe(201);

      // Third request on instance 1 -> rejected with 429
      const rejected1 = await app1.request("/v1/waitlist", postBody);
      expect(rejected1.status).toBe(429);

      // Fourth request on instance 2 -> rejected with 429
      const rejected2 = await app2.request("/v1/waitlist", postBody);
      expect(rejected2.status).toBe(429);
    });
  });

  describe("Trusted proxy and anti-spoofing", () => {
    it("a spoofed X-Forwarded-For cannot evade or poison a limit when no trusted proxy is configured", async () => {
      const rateLimitStore = new PostgresRateLimitStore(sql);

      // Simulated socket address of the attacker
      const attackerSocket = "198.51.100.99";
      let requestSocket = attackerSocket;

      const app = createApp({
        rateLimitStore,
        principal: null,
        policy: devPolicy,
        logger: { log: () => {} },
        // Injectable trusted-proxy client-IP resolver, safe by default (trustedHops: 0)
        clientIp: (context) => clientIp(requestSocket, context.req.header("x-forwarded-for"), 0),
        rateLimits: {
          ip: { capacity: 2, refillMs: 60_000 },
          principal: { capacity: 100, refillMs: 60_000 },
        },
      });

      const reqMe = (xff?: string) =>
        app.request("/v1/openapi.json", {
          headers: xff ? { "x-forwarded-for": xff } : {},
        });

      // 1. Evasion attempt:
      // Request 1: Attacker sends spoofed XFF 1.1.1.1
      expect((await reqMe("1.1.1.1")).status).toBe(200);

      // Request 2: Attacker rotates spoofed XFF to 2.2.2.2 trying to evade limit
      expect((await reqMe("2.2.2.2")).status).toBe(200);

      // Request 3: Attacker rotates spoofed XFF to 3.3.3.3 -> MUST BE REJECTED!
      // Rotating XFF cannot evade the rate limit because hops === 0 resolves to attackerSocket.
      const evaded = await reqMe("3.3.3.3");
      expect(evaded.status).toBe(429);

      // 2. Poisoning attempt: Attacker tries to poison victim socket "198.51.100.5" by sending victim's IP in XFF
      const victimSocket = "198.51.100.5";
      // Attacker attempts to exhaust victim allowance through spoofed requests (more spoofed requests than capacity 2)
      requestSocket = attackerSocket;
      for (let i = 0; i < 3; i++) {
        await reqMe(victimSocket);
      }

      // Victim makes requests from their real socket: verify full allowance remains intact
      requestSocket = victimSocket;
      expect((await reqMe()).status).toBe(200);
      expect((await reqMe()).status).toBe(200);
      expect((await reqMe()).status).toBe(429);
    });

    it("RFC 7239 Forwarded header is also ignored when hops = 0", async () => {
      const rateLimitStore = new PostgresRateLimitStore(sql);
      const socket = "198.51.100.77";

      const app = createApp({
        rateLimitStore,
        logger: { log: () => {} },
        clientIp: (context) => clientIp(socket, context.req.header("forwarded"), 0, "forwarded"),
        rateLimits: {
          ip: { capacity: 1, refillMs: 60_000 },
          principal: { capacity: 100, refillMs: 60_000 },
        },
      });

      // Request 1
      expect(
        (await app.request("/v1/openapi.json", { headers: { forwarded: 'for="10.0.0.1"' } }))
          .status,
      ).toBe(200);

      // Request 2 with different RFC 7239 header is rejected
      expect(
        (await app.request("/v1/openapi.json", { headers: { forwarded: 'for="10.0.0.2"' } }))
          .status,
      ).toBe(429);
    });
  });
});
