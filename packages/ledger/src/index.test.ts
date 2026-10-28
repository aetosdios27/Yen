import { expect, it } from "vitest";
import * as ledger from "./index.js";

it("exports all required ledger and Konto primitives", () => {
  expect(typeof ledger.recordDonation).toBe("function");
  expect(typeof ledger.reserveForExpense).toBe("function");
  expect(typeof ledger.settleExpense).toBe("function");
  expect(typeof ledger.releaseExpense).toBe("function");
  expect(typeof ledger.recordRefund).toBe("function");
  expect(typeof ledger.getBalances).toBe("function");
  expect(typeof ledger.balance).toBe("function");
  expect(typeof ledger.available).toBe("function");
  expect(typeof ledger.ensureFundAccounts).toBe("function");
  expect(typeof ledger.getFundAccountIds).toBe("function");
  expect(typeof ledger.fundAccountId).toBe("function");
  expect(typeof ledger.fundAccountName).toBe("function");
  expect(typeof ledger.replayFundEvents).toBe("function");
  expect(typeof ledger.initLedgerSchema).toBe("function");
  expect(typeof ledger.KontoInsufficientFundsError).toBe("function");
  expect(typeof ledger.KontoHoldNotFoundError).toBe("function");
});
