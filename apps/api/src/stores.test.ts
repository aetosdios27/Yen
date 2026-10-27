import { expect, it } from "vitest";
import { MemoryIdempotencyStore, MemoryRateLimitStore } from "./stores.js";

const request = { key: '["principal","key"]', requestHash: "hash", createdAt: 0 };
const response = {
  status: 201,
  headers: [["content-type", "application/json"]] satisfies [string, string][],
  bodyBase64: "e30=",
};

it("reserves atomically and replays completed responses", async () => {
  const store = new MemoryIdempotencyStore({ clock: () => 0 });
  const first = await store.begin(request);
  expect(first.kind).toBe("new");
  if (first.kind !== "new") throw new Error("Expected reservation");
  expect(await store.begin(request)).toEqual({ kind: "in_progress", requestHash: "hash" });
  await store.complete(request, first.token, response);
  expect(await store.begin(request)).toEqual({ kind: "complete", requestHash: "hash", response });
  await expect(store.complete(request, first.token, response)).rejects.toThrow();
});

it("takes over an expired lease and fences the abandoned attempt", async () => {
  let now = 0;
  const store = new MemoryIdempotencyStore({ clock: () => now, inProgressTtlMs: 30 });
  const first = await store.begin(request);
  if (first.kind !== "new") throw new Error("Expected reservation");
  now = 30;
  const replacement = await store.begin(request);
  expect(replacement.kind).toBe("new");
  if (replacement.kind !== "new") throw new Error("Expected replacement");
  expect(replacement.token).not.toBe(first.token);
  await expect(store.complete(request, first.token, response)).rejects.toThrow();
  await store.complete(request, replacement.token, response);
  expect(await store.begin(request)).toMatchObject({ kind: "complete", response });
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

it("expires completed responses after the replay window", async () => {
  let now = 0;
  const store = new MemoryIdempotencyStore({ clock: () => now, replayRetentionMs: 10 });
  const first = await store.begin(request);
  if (first.kind !== "new") throw new Error("Expected reservation");
  await store.complete(request, first.token, response);
  now = 9;
  expect(await store.begin(request)).toMatchObject({ kind: "complete" });
  now = 10;
  expect(await store.begin(request)).toMatchObject({ kind: "new" });
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
