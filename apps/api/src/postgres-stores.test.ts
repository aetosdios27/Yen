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

  describe("PostgresRateLimitStore under concurrency", () => {
    it("never admits more than the capacity when many connections consume one key at once", async () => {
      await sql`DELETE FROM rate_limits`;
      const store = new PostgresRateLimitStore(sql);
      const limit = { capacity: 10, refillMs: 3_600_000 };
      const now = 1_000_000;

      const results = await Promise.all(
        Array.from({ length: 60 }, () => store.consume("concurrent-key", limit, now)),
      );

      // The per-key advisory lock serializes read-modify-write; without it, parallel
      // transactions read the same token count and admit more than the bucket holds.
      expect(results.filter((result) => result.allowed).length).toBe(10);
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

    it("serializes first-time key admission under maxEntries across concurrent keys", async () => {
      await sql`DELETE FROM rate_limits`;
      const store = new PostgresRateLimitStore(sql, { maxEntries: 5 });
      const limit = { capacity: 1, refillMs: 60_000 };
      const now = 1000;

      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => store.consume(`parallel-key-${i}`, limit, now)),
      );

      const allowedCount = results.filter((r) => r.allowed).length;
      expect(allowedCount).toBe(5);

      const activeRows = await sql`
        SELECT key FROM rate_limits WHERE expires_at > to_timestamp(${now} / 1000.0)
      `;
      expect(activeRows.length).toBe(5);
    });

    it("enforces maxEntries admission cap when reviving an expired key", async () => {
      await sql`DELETE FROM rate_limits`;
      const store = new PostgresRateLimitStore(sql, { maxEntries: 1 });
      const limit = { capacity: 1, refillMs: 1000 };

      const resA1 = await store.consume("key-A", limit, 1000);
      expect(resA1.allowed).toBe(true);

      const resB = await store.consume("key-B", limit, 3000);
      expect(resB.allowed).toBe(true);

      const resA2 = await store.consume("key-A", limit, 3500);
      expect(resA2).toEqual({
        allowed: false,
        overloaded: true,
        retryAfterSeconds: expect.any(Number),
      });

      const activeRows = await sql`
        SELECT key FROM rate_limits WHERE expires_at > to_timestamp(3500 / 1000.0)
      `;
      expect(activeRows.map((r) => r.key)).toEqual(["key-B"]);
    });
  });
});
