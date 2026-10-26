import { expect, it } from "vitest";
import { MemoryIdempotencyStore, MemoryRateLimitStore } from "./stores.js";

it("reserves idempotency keys atomically and preserves complete responses", async () => {
  const store = new MemoryIdempotencyStore();
  const request = { key: '["principal","key"]', requestHash: "hash", createdAt: 0 };
  const results = await Promise.all([store.begin(request), store.begin(request)]);
  expect(results).toEqual([{ kind: "new" }, { kind: "in_progress", requestHash: "hash" }]);
  const response = {
    status: 201,
    headers: [["content-type", "application/json"]] satisfies [string, string][],
    bodyBase64: "e30=",
  };
  await store.complete(request, response);
  expect(await store.begin(request)).toEqual({ kind: "complete", requestHash: "hash", response });
  await expect(store.complete(request, response)).rejects.toThrow();
});

it("refills token buckets by elapsed time and isolates keys", async () => {
  const store = new MemoryRateLimitStore();
  const limit = { capacity: 2, refillMs: 10000 };
  expect(await store.consume("a", limit, 0)).toEqual({ allowed: true });
  expect(await store.consume("a", limit, 0)).toEqual({ allowed: true });
  expect(await store.consume("a", limit, 0)).toEqual({ allowed: false, retryAfterSeconds: 5 });
  expect(await store.consume("b", limit, 0)).toEqual({ allowed: true });
  expect(await store.consume("a", limit, 5000)).toEqual({ allowed: true });
});
