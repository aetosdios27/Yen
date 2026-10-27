import type { KontoTransactionExecutor } from "@konto-ledger/types";
import { describe, expect, it } from "vitest";
import { asQueryExecutor, recordDonation, recordRefund, reserveForExpense } from "./operations.js";

describe("input validations and executor wrapper", () => {
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
        amount: 0n,
      }),
    ).rejects.toThrow("Donation amount must be positive paise");

    await expect(
      recordDonation(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: -500n,
      }),
    ).rejects.toThrow("Donation amount must be positive paise");
  });

  it("rejects zero or negative reserve amounts before ledger mutations", async () => {
    await expect(
      reserveForExpense(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: 0n,
      }),
    ).rejects.toThrow("Reserve amount must be positive paise");

    await expect(
      reserveForExpense(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: -100n,
      }),
    ).rejects.toThrow("Reserve amount must be positive paise");
  });

  it("rejects zero or negative refund amounts before ledger mutations", async () => {
    await expect(
      recordRefund(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: 0n,
        donationId: "0194ebc4-94e8-7000-8000-000000000002",
      }),
    ).rejects.toThrow("Refund amount must be positive paise");

    await expect(
      recordRefund(dummyTx, {
        fundId: "0194ebc4-94e8-7000-8000-000000000001",
        amount: -50n,
        donationId: "0194ebc4-94e8-7000-8000-000000000002",
      }),
    ).rejects.toThrow("Refund amount must be positive paise");
  });

  it("asQueryExecutor wraps raw executors without begin method seamlessly", async () => {
    const rawFn = (_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> =>
      Promise.resolve([{ ok: true }]);
    const raw = Object.assign(rawFn, {
      unsafe: () => Promise.resolve([]),
      json: (v: unknown) => v,
    }) as unknown as KontoTransactionExecutor;

    const queryExec = asQueryExecutor(raw);
    expect(typeof queryExec.begin).toBe("function");

    const result = await queryExec.begin(async (_tx) => {
      return { inTx: true };
    });
    expect(result).toEqual({ inTx: true });
  });

  it("asQueryExecutor preserves existing begin method if present", () => {
    const customBegin = () => Promise.resolve("custom");
    const rawFn = (_strings: TemplateStringsArray) => Promise.resolve([]);
    const existing = Object.assign(rawFn, {
      unsafe: () => Promise.resolve([]),
      json: (v: unknown) => v,
      begin: customBegin,
    });

    const queryExec = asQueryExecutor(existing as unknown as KontoTransactionExecutor);
    expect(queryExec.begin).toBe(customBegin);
  });
});
