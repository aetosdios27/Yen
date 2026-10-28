import { describe, expect, it } from "vitest";
import { MemoryIdempotencyStore, MemoryRateLimitStore } from "./stores.js";
import { idempotencyStoreConformance, rateLimitStoreConformance } from "./stores-conformance.js";

const request = { key: '["principal","key"]', requestHash: "hash", createdAt: 0 };
const response = {
  status: 201,
  headers: [["content-type", "application/json"]] satisfies [string, string][],
  bodyBase64: "e30=",
};

describe("MemoryIdempotencyStore conformance", () => {
  idempotencyStoreConformance(async (options) => ({
    store: new MemoryIdempotencyStore(options),
  }));
});

describe("MemoryRateLimitStore conformance", () => {
  rateLimitStoreConformance(async (options) => ({
    store: new MemoryRateLimitStore(options),
  }));
});

it("caps retained completed responses", async () => {
  const store = new MemoryIdempotencyStore({ clock: () => 0, maxEntries: 2 });
  for (const key of ["a", "b", "c"]) {
    const entry = { ...request, key };
    const reservation = await store.begin(entry);
    if (reservation.kind !== "new") throw new Error("Expected reservation");
    await store.complete(entry, reservation.token, response);
  }
  expect(await store.begin({ ...request, key: "a" })).toMatchObject({ kind: "new" });
});

it("evicts the oldest completed entry and keeps in-progress reservations", async () => {
  const store = new MemoryIdempotencyStore({ clock: () => 0, maxEntries: 4 });
  const reserve = async (key: string) => {
    const entry = { ...request, key };
    const reservation = await store.begin(entry);
    if (reservation.kind !== "new") throw new Error("Expected reservation");
    return { entry, token: reservation.token };
  };
  const inProgressA = await reserve("a");
  const completedB = await reserve("b");
  await store.complete(completedB.entry, completedB.token, response);
  const inProgressC = await reserve("c");
  const completedD = await reserve("d");
  await store.complete(completedD.entry, completedD.token, response);

  const addedE = await reserve("e");

  expect(await store.begin(inProgressA.entry)).toEqual({
    kind: "in_progress",
    requestHash: "hash",
  });
  expect(await store.begin(inProgressC.entry)).toEqual({
    kind: "in_progress",
    requestHash: "hash",
  });
  expect(await store.begin(addedE.entry)).toEqual({ kind: "in_progress", requestHash: "hash" });
  expect(await store.begin(completedD.entry)).toMatchObject({ kind: "complete" });
  expect(await store.begin(completedB.entry)).toMatchObject({ kind: "new" });
});

it("refuses capacity when every retained entry is in progress", async () => {
  const store = new MemoryIdempotencyStore({ clock: () => 0, maxEntries: 1 });
  const reservation = await store.begin(request);
  if (reservation.kind !== "new") throw new Error("Expected reservation");
  await expect(store.begin({ ...request, key: "other" })).rejects.toThrow(
    "Idempotency store capacity exhausted",
  );
});

it("evicts full idle buckets and caps active buckets", async () => {
  const store = new MemoryRateLimitStore({ maxEntries: 2 });
  const limit = { capacity: 1, refillMs: 10 };
  await store.consume("a", limit, 0);
  await store.consume("b", limit, 0);
  expect(await store.consume("c", limit, 0)).toEqual({
    allowed: false,
    overloaded: true,
    retryAfterSeconds: 1,
  });
  expect(await store.consume("a", limit, 0)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  await store.consume("d", limit, 10);
  expect(store.entryCount).toBe(1);
});

it("does not visit live buckets when admitting a request", async () => {
  const store = new MemoryRateLimitStore({ maxEntries: 100_000 });
  const buckets: unknown = Reflect.get(store, "buckets");
  if (!(buckets instanceof Map)) throw new Error("Expected buckets map");
  for (let i = 0; i < 100_000; i++) {
    await store.consume(String(i), { capacity: 1, refillMs: 3_600_000 }, 0);
  }
  let visited = 0;
  const original = buckets[Symbol.iterator].bind(buckets);
  Object.defineProperty(buckets, Symbol.iterator, {
    value: function* () {
      for (const entry of original()) {
        visited++;
        yield entry;
      }
    },
  });
  const originalValues = buckets.values.bind(buckets);
  Object.defineProperty(buckets, "values", {
    value: function* () {
      for (const entry of originalValues()) {
        visited++;
        yield entry;
      }
    },
  });
  await store.consume("0", { capacity: 1, refillMs: 3_600_000 }, 0);
  expect(await store.consume("new", { capacity: 1, refillMs: 3_600_000 }, 0)).toMatchObject({
    overloaded: true,
  });
  expect(visited).toBeLessThan(10);
});
