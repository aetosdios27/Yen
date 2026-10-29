import { describe, expect, it } from "vitest";
import { MemoryPinStore, type NewPinRecord } from "./store.js";

const record: NewPinRecord = {
  userId: "00000000-0000-4000-8000-000000000001",
  salt: "s".repeat(16),
  pinHash: "h".repeat(30),
  failedAttempts: 0,
  totalFailed24h: 0,
  firstFailedAt: null,
  lockedUntil: null,
  coolingOffUntil: null,
  status: "active",
};

describe("MemoryPinStore.withLock", () => {
  it("runs critical sections for one user one at a time", async () => {
    const store = new MemoryPinStore();
    await store.create(record);

    const increment = () =>
      store.withLock(record.userId, async (current, tx) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await tx.update({ failedAttempts: (current?.failedAttempts ?? 0) + 1 });
      });
    await Promise.all(Array.from({ length: 10 }, increment));

    expect((await store.get(record.userId))?.failedAttempts).toBe(10);
  });

  it("restores the record and releases the lock when the section throws", async () => {
    const store = new MemoryPinStore();
    await store.create(record);

    await expect(
      store.withLock(record.userId, async (_current, tx) => {
        await tx.update({ failedAttempts: 3 });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect((await store.get(record.userId))?.failedAttempts).toBe(0);
    expect(await store.withLock(record.userId, async (current) => current?.failedAttempts)).toBe(0);
  });

  it("creates a missing record through the transaction", async () => {
    const store = new MemoryPinStore();

    await store.withLock(record.userId, async (current, tx) => {
      expect(current).toBeNull();
      await tx.create(record);
    });

    expect((await store.get(record.userId))?.status).toBe("active");
  });
});
