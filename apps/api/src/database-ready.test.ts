import type { Sql } from "@yen/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDatabaseReady } from "./database-ready.js";

type Pending = Promise<unknown> & { cancel: () => unknown };

function stalledSql(cancel: () => unknown, end = vi.fn()): Sql {
  const tx = (): Pending => Object.assign(new Promise<unknown>(() => {}), { cancel });
  return {
    begin: (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
    end,
  } as unknown as Sql;
}

const unhandled: unknown[] = [];
const record = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  process.on("unhandledRejection", record);
});

afterEach(() => {
  process.off("unhandledRejection", record);
  vi.useRealTimers();
});

async function settle() {
  await vi.advanceTimersByTimeAsync(2100);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

it("returns false and leaks no unhandled rejection when cancel() rejects at the deadline", async () => {
  const ready = createDatabaseReady(
    () => stalledSql(() => Promise.reject(new Error("cancel failed"))),
    { cacheMs: 0 },
  );
  const result = ready();
  await settle();
  await expect(result).resolves.toBe(false);
  expect(unhandled).toEqual([]);
});

it("returns false and leaks no unhandled rejection when cancel() throws synchronously", async () => {
  const ready = createDatabaseReady(
    () =>
      stalledSql(() => {
        throw new Error("cancel threw");
      }),
    { cacheMs: 0 },
  );
  const result = ready();
  await settle();
  await expect(result).resolves.toBe(false);
  expect(unhandled).toEqual([]);
});

it("retires a permanently stalled probe so a later check can recover", async () => {
  const end = vi.fn(() => Promise.reject(new Error("end failed")));
  const firstClient = stalledSql(() => Promise.reject(new Error("cancel failed")), end);
  const healthy = { ...firstClient, begin: vi.fn().mockResolvedValue(undefined), end: vi.fn() };
  const factory = vi.fn().mockReturnValueOnce(firstClient).mockReturnValueOnce(healthy);
  const ready = createDatabaseReady(factory, { cacheMs: 100 });
  const first = ready();
  await settle();
  expect(await first).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(await ready()).toBe(true);
  expect(factory).toHaveBeenCalledTimes(2);
  expect(end).toHaveBeenCalledOnce();
  expect(end).toHaveBeenCalledWith({ timeout: 0 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(unhandled).toEqual([]);
});
