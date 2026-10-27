import { migrate } from "@yen/db";
import { beforeAll, describe, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { PostgresIdempotencyStore, PostgresRateLimitStore } from "./postgres-stores.js";
import { idempotencyStoreConformance, rateLimitStoreConformance } from "./stores-conformance.js";

databaseSuite("Postgres stores conformance", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  describe("PostgresIdempotencyStore conformance", () => {
    idempotencyStoreConformance(async (options) => {
      const store = new PostgresIdempotencyStore(sql, options);
      return {
        store,
        cleanup: async () => {
          await sql`DELETE FROM idempotency_keys`;
        },
      };
    });

    it("sweeps expired completed responses and expired leases while preserving active ones", async () => {
      await sql`DELETE FROM idempotency_keys`;
      let now = 100_000;
      const store = new PostgresIdempotencyStore(sql, {
        clock: () => now,
        inProgressTtlMs: 10_000,
        replayRetentionMs: 50_000,
      });

      // Entry 1: will become an expired lease (lease expires at 110_000)
      const res1 = await store.begin({ key: "expired-lease", requestHash: "h1", createdAt: now });
      expect(res1.kind).toBe("new");

      // Entry 2: completed, will expire (replay expires at 150_000)
      const res2 = await store.begin({ key: "expired-replay", requestHash: "h2", createdAt: now });
      expect(res2.kind).toBe("new");
      if (res2.kind === "new") {
        await store.complete(
          { key: "expired-replay", requestHash: "h2", createdAt: now },
          res2.token,
          { status: 200, headers: [], bodyBase64: null },
        );
      }

      // Advance time to 200_000 so entry 1 and entry 2 expire
      now = 200_000;

      // Entry 3: active in-progress reservation created at 200_000 (lease expires at 210_000)
      const res3 = await store.begin({ key: "active-lease", requestHash: "h3", createdAt: now });
      expect(res3.kind).toBe("new");

      // Entry 4: completed created at 200_000 (replay expires at 250_000)
      const res4 = await store.begin({ key: "active-replay", requestHash: "h4", createdAt: now });
      expect(res4.kind).toBe("new");
      if (res4.kind === "new") {
        await store.complete(
          { key: "active-replay", requestHash: "h4", createdAt: now },
          res4.token,
          { status: 200, headers: [], bodyBase64: null },
        );
      }

      // Sweep at now = 200_000
      const sweptCount = await store.sweep(now);
      expect(sweptCount).toBe(2);

      // Verify expired entries were swept (they can be reserved anew)
      const sweptLease = await store.begin({
        key: "expired-lease",
        requestHash: "h1",
        createdAt: now,
      });
      expect(sweptLease.kind).toBe("new");

      const sweptReplay = await store.begin({
        key: "expired-replay",
        requestHash: "h2",
        createdAt: now,
      });
      expect(sweptReplay.kind).toBe("new");

      // Active lease and active replay are still present
      const activeLease = await store.begin({
        key: "active-lease",
        requestHash: "h3",
        createdAt: now,
      });
      expect(activeLease.kind).toBe("in_progress");

      const activeReplay = await store.begin({
        key: "active-replay",
        requestHash: "h4",
        createdAt: now,
      });
      expect(activeReplay.kind).toBe("complete");
    });
  });

  describe("PostgresRateLimitStore conformance", () => {
    rateLimitStoreConformance(async (options) => {
      const store = new PostgresRateLimitStore(sql, options);
      return {
        store,
        cleanup: async () => {
          await sql`DELETE FROM rate_limits`;
        },
      };
    });

    it("caps active buckets and signals overloaded when maxEntries is exceeded", async () => {
      await sql`DELETE FROM rate_limits`;
      const store = new PostgresRateLimitStore(sql, { maxEntries: 2 });
      const limit = { capacity: 1, refillMs: 10_000 };

      expect(await store.consume("ip-1", limit, 0)).toEqual({ allowed: true });
      expect(await store.consume("ip-2", limit, 0)).toEqual({ allowed: true });

      // Third distinct key exceeds maxEntries
      const overloaded = await store.consume("ip-3", limit, 0);
      expect(overloaded).toEqual({
        allowed: false,
        overloaded: true,
        retryAfterSeconds: expect.any(Number),
      });

      // Existing active key is still evaluated
      expect(await store.consume("ip-1", limit, 0)).toEqual({
        allowed: false,
        retryAfterSeconds: 10,
      });
    });

    it("prunes full or expired buckets", async () => {
      await sql`DELETE FROM rate_limits`;
      const store = new PostgresRateLimitStore(sql);
      const limit = { capacity: 1, refillMs: 1000 };

      await store.consume("p1", limit, 0); // fullAt = 1000
      await store.consume("p2", limit, 0); // fullAt = 1000
      await store.consume("p3", limit, 5000); // fullAt = 6000

      // At t = 2000, p1 and p2 are expired, p3 is still active
      const pruned = await store.prune(2000);
      expect(pruned).toBe(2);

      const remaining = await sql`SELECT key FROM rate_limits`;
      expect(remaining.map((r) => r.key)).toEqual(["p3"]);
    });
  });
});
