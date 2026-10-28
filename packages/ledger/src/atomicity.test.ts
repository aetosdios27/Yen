import type { KontoTransactionExecutor } from "@konto-ledger/types";
import type { Paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import {
  assertTransactionExecutor,
  asTransactionQueryExecutor,
  recordDonation,
  recordRefund,
  reserveForExpense,
} from "./operations.js";

describe("input validations and transaction executor assertions", () => {
  const dummyFn = (_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> =>
    Promise.resolve([]);
  const dummyTx = Object.assign(dummyFn, {
    unsafe: (_query: string, _parameters?: unknown[]) => Promise.resolve([]),
    json: (v: unknown) => v,
  }) as unknown as KontoTransactionExecutor;

  it("rejects zero or negative donation amounts before ledger mutations", async () => {
    await expect(
      recordDonation(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: 0 as unknown as Paise,
      }),
    ).rejects.toThrow("Donation amount must be positive paise");

    await expect(
      recordDonation(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: -500 as unknown as Paise,
      }),
    ).rejects.toThrow("Donation amount must be positive paise");

    await expect(
      recordDonation(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: 1.5 as unknown as Paise,
      }),
    ).rejects.toThrow("Paise must be a safe integer");
  });

  it("rejects zero or negative reserve amounts before ledger mutations", async () => {
    await expect(
      reserveForExpense(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: 0 as unknown as Paise,
      }),
    ).rejects.toThrow("Reserve amount must be positive paise");

    await expect(
      reserveForExpense(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: -100 as unknown as Paise,
      }),
    ).rejects.toThrow("Reserve amount must be positive paise");
  });

  it("rejects refund when donation is not found", async () => {
    await expect(
      recordRefund(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        donationId: "0194ebc4-94e8-7000-8000-000000000002",
      }),
    ).rejects.toThrow("Donation 0194ebc4-94e8-7000-8000-000000000002 not found");
  });

  it("assertTransactionExecutor rejects connection pools with begin method", () => {
    const poolFn = (_strings: TemplateStringsArray) => Promise.resolve([]);
    const pool = Object.assign(poolFn, {
      unsafe: () => Promise.resolve([]),
      json: (v: unknown) => v,
      begin: () => Promise.resolve(),
    }) as unknown as KontoTransactionExecutor;

    expect(() => assertTransactionExecutor(pool)).toThrow(
      /Expected a transaction handle \(KontoTransactionExecutor\), but received a query executor \/ pool/,
    );
  });

  it("assertTransactionExecutor accepts transaction handles with savepoint method", () => {
    const txFn = (_strings: TemplateStringsArray) => Promise.resolve([]);
    const txHandle = Object.assign(txFn, {
      unsafe: () => Promise.resolve([]),
      json: (v: unknown) => v,
      begin: () => Promise.resolve(),
      savepoint: () => Promise.resolve(),
    }) as unknown as KontoTransactionExecutor;

    expect(() => assertTransactionExecutor(txHandle)).not.toThrow();
  });

  it("asTransactionQueryExecutor routes begin calls within the same transaction handle", async () => {
    const rawFn = (_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> =>
      Promise.resolve([{ ok: true }]);
    const raw = Object.assign(rawFn, {
      unsafe: () => Promise.resolve([]),
      json: (v: unknown) => v,
    }) as unknown as KontoTransactionExecutor;

    const queryExec = asTransactionQueryExecutor(raw);
    expect(typeof queryExec.begin).toBe("function");

    // begin callback receives the same transaction handle without spawning an isolated transaction
    let capturedTx: unknown = null;
    const result = await queryExec.begin(async (innerTx) => {
      capturedTx = innerTx;
      return { inTx: true };
    });
    expect(result).toEqual({ inTx: true });
    expect(capturedTx).toBe(raw);
  });
});
