import type { Sql } from "@yen/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDatabaseReady } from "./database-ready.js";

type Pending = Promise<unknown> & { cancel: () => unknown };

function stalledSql(cancel: () => unknown): Sql {
  const tx = (): Pending => Object.assign(new Promise<unknown>(() => {}), { cancel });
  return {
    begin: (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
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
    stalledSql(() => Promise.reject(new Error("cancel failed"))),
    { cacheMs: 0 },
  );
  const result = ready();
  await settle();
  await expect(result).resolves.toBe(false);
  expect(unhandled).toEqual([]);
});

it("returns false and leaks no unhandled rejection when cancel() throws synchronously", async () => {
  const ready = createDatabaseReady(
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
