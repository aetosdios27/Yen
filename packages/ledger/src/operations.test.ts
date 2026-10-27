import { KontoInsufficientFundsError } from "@konto-ledger/core";
import { uuidv7 } from "@yen/db";
import { chainHead, checkChainStructure, verifyChain } from "@yen/eventlog";
import { paise, parseFundId } from "@yen/shared";
import { expect, it } from "vitest";
import { getFundEvents } from "./eventlog.js";
import {
  available,
  balance,
  getBalances,
  type RecordDonationResult,
  recordDonation,
  recordRefund,
  releaseExpense,
  reserveForExpense,
  settleExpense,
} from "./operations.js";
import { replayFundEvents } from "./replay.js";
import { ledgerDatabaseSuite } from "./test/database.js";

ledgerDatabaseSuite("Ledger operations with Konto and event log integration", (sql) => {
  it("AC1: Killing the transaction between ledger write and event write leaves neither in DB", async () => {
    const fundId = uuidv7();

    // Attempt a transaction that writes to ledger and then aborts/throws
    await expect(
      sql.begin(async (tx) => {
        // Record donation in Konto within tx
        await recordDonation(tx, {
          fundId,
          amount: paise(50000),
          reference: "crash-test-ref",
        });

        // Simulate crash/error before commit
        throw new Error("Simulated process kill / network crash before commit");
      }),
    ).rejects.toThrow("Simulated process kill / network crash before commit");

    // Verify neither ledger rows nor event rows were persisted
    const journals = await sql`
      SELECT j.id FROM konto_journals j
      JOIN konto_accounts a ON a.id = j.account_id
      WHERE a.name = ${`fund:${fundId}:bank`}
    `;
    expect(journals).toHaveLength(0);

    const events = await sql`
      SELECT seq FROM fund_events WHERE fund_id = ${fundId}
    `;
    expect(events).toHaveLength(0);

    const balances = await getBalances(sql, fundId);
    expect(balances.bankPaise).toBe(0n);
    expect(balances.availablePaise).toBe(0n);
  });

  it("AC3: Overspend is impossible: a request above available balance is rejected atomically", async () => {
    const fundId = uuidv7();

    // Seed fund with 50,000 paise
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(50000),
        reference: "seed-ref",
      });
    });

    expect(await available(sql, fundId)).toBe(50000n);

    // Attempt to reserve 50,001 paise (exceeding available balance by 1 paise)
    await expect(
      sql.begin(async (tx) => {
        await reserveForExpense(tx, {
          fundId,
          amount: paise(50001),
          description: "Overspend attempt",
        });
      }),
    ).rejects.toThrow(KontoInsufficientFundsError);

    // Assert that available balance is still 50,000 paise and no holds or events were created
    const balances = await getBalances(sql, fundId);
    expect(balances.availablePaise).toBe(50000n);
    expect(balances.pendingSpendPaise).toBe(0n);

    const holds = await sql`
      SELECT h.id FROM konto_holds h
      JOIN konto_accounts a ON a.id = h.account_id
      WHERE a.name = ${`fund:${fundId}:bank`}
    `;
    expect(holds).toHaveLength(0);
  });

  it("AC4: Idempotency: the same donation reported twice posts once", async () => {
    const fundId = uuidv7();
    const reference = "utr_unique_1234567890";

    let result1: RecordDonationResult | undefined;
    let result2: RecordDonationResult | undefined;

    await sql.begin(async (tx) => {
      result1 = await recordDonation(tx, {
        fundId,
        amount: paise(75000),
        reference,
      });
    });

    await sql.begin(async (tx) => {
      result2 = await recordDonation(tx, {
        fundId,
        amount: paise(75000),
        reference,
      });
    });

    expect(result1?.duplicate).toBeUndefined();
    expect(result2?.duplicate).toBe(true);
    expect(result1?.journalId).toBe(result2?.journalId);

    // Verify exactly one journal entry exists for the idempotency key
    const journals = await sql`
      SELECT j.id FROM konto_journals j
      WHERE j.idempotency_key = ${`donation:${reference}`}
    `;
    expect(journals).toHaveLength(1);

    // Verify balance was credited only once
    const currentBalance = await balance(sql, fundId);
    expect(currentBalance).toBe(75000n);
  });

  it("Full money flow: donation -> reserve -> settle -> release -> refund with AC2 replay parity", async () => {
    const fundId = uuidv7();

    // 1. Initial donation: 100,000 paise
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(100000),
        reference: "ref-donation-1",
      });
    });

    expect(await balance(sql, fundId)).toBe(100000n);
    expect(await available(sql, fundId)).toBe(100000n);

    // 2. Reserve for expense 1: 30,000 paise
    let hold1Id = "";
    let expense1Id = "";
    await sql.begin(async (tx) => {
      const res = await reserveForExpense(tx, {
        fundId,
        amount: paise(30000),
        description: "Travel reimbursement",
      });
      hold1Id = res.holdId;
      expense1Id = res.expenseId;
    });

    // Holds reduce "available" but not "balance"
    expect(await balance(sql, fundId)).toBe(100000n);
    expect(await available(sql, fundId)).toBe(70000n);

    // 3. Settle expense 1
    await sql.begin(async (tx) => {
      await settleExpense(tx, {
        fundId,
        holdId: hold1Id,
        expenseId: expense1Id,
        receiptRef: "receipt-101",
      });
    });

    // Settled expense reduces bank balance and clears pending hold
    expect(await balance(sql, fundId)).toBe(70000n);
    expect(await available(sql, fundId)).toBe(70000n);

    // 4. Reserve expense 2: 25,000 paise
    let hold2Id = "";
    let expense2Id = "";
    await sql.begin(async (tx) => {
      const res = await reserveForExpense(tx, {
        fundId,
        amount: paise(25000),
        description: "Conference tickets",
      });
      hold2Id = res.holdId;
      expense2Id = res.expenseId;
    });

    expect(await balance(sql, fundId)).toBe(70000n);
    expect(await available(sql, fundId)).toBe(45000n);

    // 5. Release expense 2 (rejected by policy/approver)
    await sql.begin(async (tx) => {
      await releaseExpense(tx, {
        fundId,
        holdId: hold2Id,
        expenseId: expense2Id,
        reason: "policy",
      });
    });

    // Released hold returns available funds to bank
    expect(await balance(sql, fundId)).toBe(70000n);
    expect(await available(sql, fundId)).toBe(70000n);

    // 6. Record second donation: 50,000 paise
    let donation2Id = "";
    await sql.begin(async (tx) => {
      const res = await recordDonation(tx, {
        fundId,
        amount: paise(50000),
        reference: "ref-donation-2",
      });
      donation2Id = (res.pledgeEvent.payload as { donation_id: string }).donation_id;
    });

    expect(await balance(sql, fundId)).toBe(120000n);
    expect(await available(sql, fundId)).toBe(120000n);

    // 7. Record refund for donation 2: 50,000 paise
    await sql.begin(async (tx) => {
      await recordRefund(tx, {
        fundId,
        amount: paise(50000),
        donationId: donation2Id,
        reason: "cancelled",
      });
    });

    expect(await balance(sql, fundId)).toBe(70000n);
    expect(await available(sql, fundId)).toBe(70000n);

    // 8. Replay Parity Test (AC2)
    // Fetch all events from database
    const dbEvents = await getFundEvents(sql, fundId);
    expect(dbEvents.length).toBeGreaterThan(0);

    // Verify cryptographic event chain is valid and unbroken
    const structure = await checkChainStructure(dbEvents);
    expect(structure.status).toBe("structure-consistent");

    const lastEvent = dbEvents[dbEvents.length - 1];
    if (!lastEvent) throw new Error("No events found in database");

    const parsedFundId = parseFundId(fundId);
    if (!parsedFundId.ok) throw new Error("Invalid fund id");

    const head = chainHead({
      fundId: parsedFundId.value,
      count: dbEvents.length,
      latestHash: lastEvent.hash,
    });
    const verification = await verifyChain(dbEvents, head);
    expect(verification.ok).toBe(true);

    // Replay events and compare against live ledger balances
    const ledgerBalances = await getBalances(sql, fundId);
    const replayedBalances = replayFundEvents(fundId, dbEvents);

    expect(replayedBalances).toEqual(ledgerBalances);
    expect(ledgerBalances.bankPaise).toBe(70000n);
    expect(ledgerBalances.availablePaise).toBe(70000n);
    expect(ledgerBalances.donationsPaise).toBe(100000n);
    expect(ledgerBalances.expensesPaise).toBe(30000n);
    expect(ledgerBalances.pendingSpendPaise).toBe(0n);
  });

  it("fund_events table is append-only and rejects UPDATE, DELETE, and TRUNCATE via triggers", async () => {
    const fundId = uuidv7();
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: 25000,
        reference: "immutability-test",
      });
    });

    // Attempt UPDATE on fund_events
    await expect(
      sql`UPDATE fund_events SET type = 'tampered' WHERE fund_id = ${fundId}`,
    ).rejects.toThrow(/append-only/i);

    // Attempt DELETE on fund_events
    await expect(sql`DELETE FROM fund_events WHERE fund_id = ${fundId}`).rejects.toThrow(
      /append-only/i,
    );

    // Attempt TRUNCATE on fund_events
    await expect(sql`TRUNCATE TABLE fund_events`).rejects.toThrow(/append-only/i);
  });

  it("rejects cross-fund hold committal or release", async () => {
    const fundA = uuidv7();
    const fundB = uuidv7();

    let holdAId = "";
    let expenseAId = "";
    await sql.begin(async (tx) => {
      await recordDonation(tx, { fundId: fundA, amount: 50000, reference: "fund-a-seed" });
      const res = await reserveForExpense(tx, {
        fundId: fundA,
        amount: 20000,
        description: "Fund A expense",
      });
      holdAId = res.holdId;
      expenseAId = res.expenseId;
    });

    // Attempting to settle Fund A's hold under Fund B must fail
    await expect(
      sql.begin(async (tx) => {
        await settleExpense(tx, {
          fundId: fundB,
          holdId: holdAId,
          expenseId: expenseAId,
        });
      }),
    ).rejects.toThrow(/does not belong to fund/i);

    // Attempting to release Fund A's hold under Fund B must fail
    await expect(
      sql.begin(async (tx) => {
        await releaseExpense(tx, {
          fundId: fundB,
          holdId: holdAId,
          expenseId: expenseAId,
        });
      }),
    ).rejects.toThrow(/does not belong to fund/i);
  });
});
