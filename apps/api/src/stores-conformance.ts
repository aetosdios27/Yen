import { expect, it } from "vitest";
import type {
  IdempotencyOptions,
  IdempotencyStore,
  RateLimit,
  RateLimitStore,
  StoredResponse,
} from "./stores.js";

const sampleRequest = { key: '["principal","key"]', requestHash: "hash1", createdAt: 0 };
const sampleResponse: StoredResponse = {
  status: 201,
  headers: [["content-type", "application/json"]],
  bodyBase64: "e30=",
};

export function idempotencyStoreConformance(
  createStore: (options?: IdempotencyOptions) => Promise<{
    store: IdempotencyStore;
    cleanup?: () => Promise<void>;
  }>,
) {
  it("reserves atomically and replays completed responses", async () => {
    const { store, cleanup } = await createStore({ clock: () => 0 });
    try {
      const first = await store.begin(sampleRequest);
      expect(first.kind).toBe("new");
      if (first.kind !== "new") throw new Error("Expected reservation");

      expect(await store.begin(sampleRequest)).toEqual({
        kind: "in_progress",
        requestHash: "hash1",
      });

      await store.complete(sampleRequest, first.token, sampleResponse);

      expect(await store.begin(sampleRequest)).toEqual({
        kind: "complete",
        requestHash: "hash1",
        response: sampleResponse,
      });

      await expect(store.complete(sampleRequest, first.token, sampleResponse)).rejects.toThrow();
    } finally {
      await cleanup?.();
    }
  });

  it("takes over an expired lease and fences the abandoned attempt", async () => {
    let now = 0;
    const { store, cleanup } = await createStore({
      clock: () => now,
      inProgressTtlMs: 30,
    });
    try {
      const first = await store.begin(sampleRequest);
      expect(first.kind).toBe("new");
      if (first.kind !== "new") throw new Error("Expected reservation");

      now = 30;
      const replacement = await store.begin(sampleRequest);
      expect(replacement.kind).toBe("new");
      if (replacement.kind !== "new") throw new Error("Expected replacement");
      expect(replacement.token).not.toBe(first.token);

      // Abandoned attempt is fenced by the new token
      await expect(store.complete(sampleRequest, first.token, sampleResponse)).rejects.toThrow();

      // Replacement attempt succeeds
      await store.complete(sampleRequest, replacement.token, sampleResponse);
      expect(await store.begin(sampleRequest)).toMatchObject({
        kind: "complete",
        response: sampleResponse,
      });
    } finally {
      await cleanup?.();
    }
  });

  it("rejects completion when request hash differs", async () => {
    const { store, cleanup } = await createStore({ clock: () => 0 });
    try {
      const first = await store.begin(sampleRequest);
      expect(first.kind).toBe("new");
      if (first.kind !== "new") throw new Error("Expected reservation");

      await expect(
        store.complete(
          { ...sampleRequest, requestHash: "different-hash" },
          first.token,
          sampleResponse,
        ),
      ).rejects.toThrow();
    } finally {
      await cleanup?.();
    }
  });

  it("releases in-progress reservations allowing immediate re-reservation", async () => {
    const { store, cleanup } = await createStore({ clock: () => 0 });
    try {
      const first = await store.begin(sampleRequest);
      expect(first.kind).toBe("new");
      if (first.kind !== "new") throw new Error("Expected reservation");

      await store.release(sampleRequest, first.token);

      const second = await store.begin(sampleRequest);
      expect(second.kind).toBe("new");
    } finally {
      await cleanup?.();
    }
  });

  it("stale worker cannot release a taken-over lease", async () => {
    let now = 0;
    const { store, cleanup } = await createStore({
      clock: () => now,
      inProgressTtlMs: 30,
    });
    try {
      const first = await store.begin(sampleRequest);
      expect(first.kind).toBe("new");
      if (first.kind !== "new") throw new Error("Expected reservation");

      now = 30;
      const second = await store.begin(sampleRequest);
      expect(second.kind).toBe("new");
      if (second.kind !== "new") throw new Error("Expected second reservation");

      // Stale worker 1 tries to release
      await store.release(sampleRequest, first.token);

      // Second worker's reservation is untouched
      expect(await store.begin(sampleRequest)).toEqual({
        kind: "in_progress",
        requestHash: "hash1",
      });

      await store.complete(sampleRequest, second.token, sampleResponse);
      expect(await store.begin(sampleRequest)).toMatchObject({
        kind: "complete",
        response: sampleResponse,
      });
    } finally {
      await cleanup?.();
    }
  });

  it("expires completed responses after the replay retention window", async () => {
    let now = 0;
    const { store, cleanup } = await createStore({
      clock: () => now,
      replayRetentionMs: 10,
    });
    try {
      const first = await store.begin(sampleRequest);
      expect(first.kind).toBe("new");
      if (first.kind !== "new") throw new Error("Expected reservation");

      await store.complete(sampleRequest, first.token, sampleResponse);

      now = 9;
      expect(await store.begin(sampleRequest)).toMatchObject({ kind: "complete" });

      now = 10;
      expect(await store.begin(sampleRequest)).toMatchObject({ kind: "new" });
    } finally {
      await cleanup?.();
    }
  });
}

export function rateLimitStoreConformance(
  createStore: (options?: { maxEntries?: number }) => Promise<{
    store: RateLimitStore;
    cleanup?: () => Promise<void>;
  }>,
) {
  it("refills token buckets by elapsed time and isolates keys", async () => {
    const { store, cleanup } = await createStore();
    try {
      const limit: RateLimit = { capacity: 2, refillMs: 10000 };
      expect(await store.consume("a", limit, 0)).toEqual({ allowed: true });
      expect(await store.consume("a", limit, 0)).toEqual({ allowed: true });
      expect(await store.consume("a", limit, 0)).toEqual({
        allowed: false,
        retryAfterSeconds: 5,
      });
      expect(await store.consume("b", limit, 0)).toEqual({ allowed: true });
      expect(await store.consume("a", limit, 5000)).toEqual({ allowed: true });
    } finally {
      await cleanup?.();
    }
  });

  it("enforces fixed-window limits when expiresAt is configured", async () => {
    const { store, cleanup } = await createStore();
    try {
      const limit: RateLimit = { capacity: 2, refillMs: 10000, expiresAt: 10000 };
      expect(await store.consume("w", limit, 0)).toEqual({ allowed: true });
      expect(await store.consume("w", limit, 0)).toEqual({ allowed: true });
      // In fixed window, tokens do not refill until window expires
      expect(await store.consume("w", limit, 5000)).toMatchObject({ allowed: false });
      // When window expires at t=10000, bucket resets to full capacity
      expect(await store.consume("w", limit, 10000)).toEqual({ allowed: true });
    } finally {
      await cleanup?.();
    }
  });

  it("returns positive integer retryAfterSeconds on rejection", async () => {
    const { store, cleanup } = await createStore();
    try {
      const limit: RateLimit = { capacity: 1, refillMs: 60000 };
      expect(await store.consume("r", limit, 0)).toEqual({ allowed: true });
      const rejected = await store.consume("r", limit, 0);
      expect(rejected.allowed).toBe(false);
      if (!rejected.allowed) {
        expect(Number.isInteger(rejected.retryAfterSeconds)).toBe(true);
        expect(rejected.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await cleanup?.();
    }
  });

  it("does not refill from a delayed request that arrives with an earlier timestamp", async () => {
    const { store, cleanup } = await createStore();
    try {
      const limit: RateLimit = { capacity: 1, refillMs: 1000 };
      expect(await store.consume("delayed", limit, 1000)).toEqual({ allowed: true });
      // Captured at t=0 before the t=1000 request, so it runs late and must not rewind the bucket.
      expect(await store.consume("delayed", limit, 0)).toMatchObject({ allowed: false });
      // Still no time has elapsed since the bucket was written at t=1000.
      expect(await store.consume("delayed", limit, 1000)).toMatchObject({ allowed: false });
    } finally {
      await cleanup?.();
    }
  });
}
