import { KontoInsufficientFundsError } from "@konto-ledger/core";
import { chainHead, checkChainStructure, verifyChain } from "@yen/eventlog";
import { paise, parseFundId } from "@yen/shared";
import fc from "fast-check";
import { expect, it } from "vitest";
import { getFundEvents } from "./eventlog.js";
import {
  available,
  balance,
  expireExpense,
  getBalances,
  type RecordDonationResult,
  recordDonation,
  recordRefund,
  releaseExpense,
  reserveForExpense,
  settleExpense,
} from "./operations.js";
import { replayFundEvents } from "./replay.js";
import { createTestFund, ledgerDatabaseSuite } from "./test/database.js";

ledgerDatabaseSuite("Ledger operations with Konto and event log integration", (sql) => {
  it("keeps randomized donation, hold, release, commit, and refund sequences balanced and replayable", async () => {
    const steps = fc.array(
      fc.oneof(
        fc.integer({ min: 1, max: 10_000 }).map((amount) => ({ kind: "donate" as const, amount })),
        fc.integer({ min: 1, max: 10_000 }).map((amount) => ({ kind: "hold" as const, amount })),
        fc.constant({ kind: "release" as const }),
        fc.constant({ kind: "commit" as const }),
        fc.constant({ kind: "refund" as const }),
      ),
      { minLength: 1, maxLength: 30 },
    );

    await fc.assert(
      fc.asyncProperty(steps, async (sequence) => {
        const fundId = await createTestFund(sql);
        const holds: { holdId: string; expenseId: string; amount: number }[] = [];
        const donations: { donationId: string; amount: number }[] = [];
        let availableModel = 0;
        let index = 0;
        for (const step of sequence) {
          index += 1;
          if (step.kind === "donate") {
            const donationId = `0194ebc4-94e8-7000-8000-${String(index).padStart(12, "0")}`;
            await sql.begin(async (tx) => {
              await recordDonation(tx, {
                fundId,
                amount: paise(step.amount),
                donationId,
                bankTransactionId: `0194ebc4-94e8-7000-8000-${String(index + 100).padStart(12, "0")}`,
              });
            });
            donations.push({ donationId, amount: step.amount });
            availableModel += step.amount;
          } else if (step.kind === "hold") {
            if (step.amount > availableModel) continue;
            await sql.begin(async (tx) => {
              const result = await reserveForExpense(tx, { fundId, amount: paise(step.amount) });
              holds.push({
                holdId: result.holdId,
                expenseId: result.expenseId,
                amount: step.amount,
              });
            });
            availableModel -= step.amount;
          } else if (step.kind === "release" || step.kind === "commit") {
            const hold = holds.shift();
            if (!hold) continue;
            await sql.begin(async (tx) => {
              if (step.kind === "release") {
                await releaseExpense(tx, {
                  fundId,
                  holdId: hold.holdId,
                  expenseId: hold.expenseId,
                });
              } else {
                await settleExpense(tx, {
                  fundId,
                  holdId: hold.holdId,
                  expenseId: hold.expenseId,
                  bankTransactionId: `0194ebc4-94e8-7000-8000-${String(index + 200).padStart(12, "0")}`,
                });
              }
            });
            if (step.kind === "release") availableModel += hold.amount;
          } else {
            const donation = donations.shift();
            if (!donation || donation.amount > availableModel) {
              if (donation) donations.unshift(donation);
              continue;
            }
            await sql.begin((tx) =>
              recordRefund(tx, {
                fundId,
                donationId: donation.donationId,
                amount: paise(donation.amount),
              }),
            );
            availableModel -= donation.amount;
          }

          const balances = await getBalances(sql, fundId);
          const events = await getFundEvents(sql, fundId);
          const replayed = replayFundEvents(fundId, events);
          expect(balances.bankPaise).toBeGreaterThanOrEqual(0n);
          expect(balances.pendingSpendPaise).toBeLessThanOrEqual(balances.bankPaise);
          expect(balances.availablePaise).toBe(BigInt(availableModel));
          expect(replayed).toEqual(balances);
          expect(balances.bankPaise + balances.expensesPaise).toBe(balances.donationsPaise);
          expect(await checkChainStructure(events)).toMatchObject({
            status: "structure-consistent",
          });
          const sum = await sql<{ total: string }[]>`
            SELECT COALESCE(SUM(amount), 0)::text AS total
            FROM konto_entries e JOIN konto_accounts a ON a.id = e.account_id
            WHERE a.name LIKE ${`fund:${fundId}:%`}
          `;
          expect(BigInt(sum[0]?.total ?? "0")).toBe(0n);
          const journals = await sql<{ id: string; total: string }[]>`
            SELECT journal_id AS id, SUM(amount)::text AS total FROM konto_entries
            WHERE account_id IN (SELECT id FROM konto_accounts WHERE name LIKE ${`fund:${fundId}:%`})
            GROUP BY journal_id
          `;
          expect(journals.every((journal) => BigInt(journal.total) === 0n)).toBe(true);
        }
      }),
      { numRuns: 8, seed: 49061 },
    );
  });

  it("uses the migrated fund event table and rejects a broken hash chain", async () => {
    const migrations = await sql<{ name: string }[]>`
      SELECT name FROM public.schema_migrations ORDER BY version
    `;
    expect(migrations.map(({ name }) => name)).toContain("0003_fund_events.sql");

    const functionDefinition = await sql<{ definition: string }[]>`
      SELECT pg_get_functiondef('public.yen_fund_lock_key(uuid)'::regprocedure) AS definition
    `;
    expect(functionDefinition[0]?.definition).toMatch(
      /SET search_path TO ['"]?pg_catalog['"]?,\s*['"]?public['"]?,\s*['"]?pg_temp['"]?/i,
    );

    const fundId = await createTestFund(sql);
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(1000),
        reference: "seed-broken-chain-test",
      });
    });

    await expect(sql`
      INSERT INTO public.fund_events (
        fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
      )
      SELECT fund_id, seq + 1, version, type, actor, occurred_at, payload,
        ${"0".repeat(64)}, ${"f".repeat(64)}, '{}'
      FROM public.fund_events
      WHERE fund_id = ${fundId}
      ORDER BY seq DESC
      LIMIT 1
    `).rejects.toThrow(/prev_hash mismatch/i);
  });

  it("rolls back a newly created hold when event construction fails", async () => {
    const fundId = await createTestFund(sql);
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(50000),
        reference: "seed-atomic-hold-test",
      });
    });

    await sql.begin(async (tx) => {
      await expect(
        reserveForExpense(tx, {
          fundId,
          amount: paise(20000),
          occurredAt: "not-a-timestamp",
        }),
      ).rejects.toThrow(/Invalid event input/i);

      const holds = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM konto_holds h
        JOIN konto_accounts a ON a.id = h.account_id
        WHERE a.name = ${`fund:${fundId}:bank`} AND h.status = 'PENDING'
      `;
      expect(holds[0]?.count).toBe(0);
    });

    expect(await available(sql, fundId)).toBe(50000n);
  });

  it("restores a released hold when its event cannot be constructed", async () => {
    const fundId = await createTestFund(sql);
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(50000),
        reference: "seed-atomic-release-test",
      });
    });

    let holdId = "";
    let expenseId = "";
    await sql.begin(async (tx) => {
      const result = await reserveForExpense(tx, {
        fundId,
        amount: paise(20000),
      });
      holdId = result.holdId;
      expenseId = result.expenseId;
    });

    await sql.begin(async (tx) => {
      await expect(
        releaseExpense(tx, {
          fundId,
          holdId,
          expenseId,
          occurredAt: "not-a-timestamp",
        }),
      ).rejects.toThrow(/Invalid event input/i);

      const holds = await tx<{ status: string }[]>`
        SELECT status FROM konto_holds WHERE id = ${holdId}
      `;
      expect(holds[0]?.status).toBe("PENDING");
    });

    expect(await available(sql, fundId)).toBe(30000n);
  });

  it("AC1: Killing the transaction between ledger write and event write leaves neither in DB", async () => {
    const fundId = await createTestFund(sql);

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

  it("event append failure inside transaction rolls back ledger journal and entries", async () => {
    const fundId = await createTestFund(sql);

    await expect(
      sql.begin(async (tx) => {
        // Post ledger entries directly
        const accounts = await import("./accounts.js").then((m) =>
          m.ensureFundAccounts(tx, fundId),
        );
        await import("@konto-ledger/core").then((m) =>
          m.transferInTx(tx, {
            accountId: accounts.bankId,
            entries: [
              { accountId: accounts.bankId, amount: 50000n },
              { accountId: accounts.donationsId, amount: -50000n },
            ],
          }),
        );

        // Intentionally corrupt event insert that violates check constraint or table triggers
        await tx`INSERT INTO fund_events (fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash, canonical_envelope)
          VALUES (${fundId}, 0, 1, 'invalid', 'invalid', 'invalid', '{}'::jsonb, 'bad', 'bad', 'bad')`;
      }),
    ).rejects.toThrow();

    // Verify Konto entries and journals were completely rolled back
    const journals = await sql`
      SELECT j.id FROM konto_journals j
      JOIN konto_accounts a ON a.id = j.account_id
      WHERE a.name = ${`fund:${fundId}:bank`}
    `;
    expect(journals).toHaveLength(0);

    const entries = await sql`
      SELECT e.id FROM konto_entries e
      JOIN konto_accounts a ON a.id = e.account_id
      WHERE a.name = ${`fund:${fundId}:bank`}
    `;
    expect(entries).toHaveLength(0);
  });

  it("AC3: Overspend is impossible: a request above available balance is rejected atomically", async () => {
    const fundId = await createTestFund(sql);

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

  it("concurrent reservations that together exceed available balance serialize so exactly one succeeds", async () => {
    const fundId = await createTestFund(sql);
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(50000),
        reference: "concurrent-seed",
      });
    });

    expect(await available(sql, fundId)).toBe(50000n);

    // Launch two concurrent 35,000 paise reservations (35k + 35k = 70k > 50k)
    const results = await Promise.allSettled([
      sql.begin((tx) =>
        reserveForExpense(tx, {
          fundId,
          amount: paise(35000),
          description: "Concurrent reserve 1",
        }),
      ),
      sql.begin((tx) =>
        reserveForExpense(tx, {
          fundId,
          amount: paise(35000),
          description: "Concurrent reserve 2",
        }),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const firstRejected = rejected[0];
    if (!firstRejected) throw new Error("Expected at least one rejected result");
    expect(firstRejected.reason).toBeInstanceOf(KontoInsufficientFundsError);

    const balances = await getBalances(sql, fundId);
    expect(balances.availablePaise).toBe(15000n);
    expect(balances.pendingSpendPaise).toBe(35000n);
  });

  it("AC4: Idempotency: the same donation reported twice posts once", async () => {
    const fundId = await createTestFund(sql);
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

  it("rejects duplicate donation with same idempotency key but different amount", async () => {
    const fundId = await createTestFund(sql);
    const reference = "utr_mismatch_test";

    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(1000),
        reference,
      });
    });

    await expect(
      sql.begin(async (tx) => {
        await recordDonation(tx, {
          fundId,
          amount: paise(500000),
          reference,
        });
      }),
    ).rejects.toThrow(/Idempotency conflict/i);
  });

  it("reserveForExpense is idempotent on retry with same parameters, and rejects different amount", async () => {
    const fundId = await createTestFund(sql);
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(100000),
        reference: "seed-for-reserve-idempotency",
      });
    });

    const idempotencyKey = "hold_key_12345";
    let hold1Res: unknown;
    await sql.begin(async (tx) => {
      hold1Res = await reserveForExpense(tx, {
        fundId,
        amount: paise(25000),
        idempotencyKey,
        description: "Reserved expense",
      });
    });

    // Retry with identical key and amount returns the existing hold with duplicate: true
    let hold2Res: unknown;
    await sql.begin(async (tx) => {
      hold2Res = await reserveForExpense(tx, {
        fundId,
        amount: paise(25000),
        idempotencyKey,
        description: "Reserved expense",
      });
    });

    expect((hold2Res as { duplicate?: boolean }).duplicate).toBe(true);
    expect((hold2Res as { holdId: string }).holdId).toBe((hold1Res as { holdId: string }).holdId);

    // Retry with same key but different amount throws conflict error
    await expect(
      sql.begin(async (tx) => {
        await reserveForExpense(tx, {
          fundId,
          amount: paise(40000),
          idempotencyKey,
          description: "Conflicting amount",
        });
      }),
    ).rejects.toThrow(/Idempotency conflict/i);
  });

  it("expireExpense releases hold and restores available balance", async () => {
    const fundId = await createTestFund(sql);
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(60000),
        reference: "seed-expire-test",
      });
    });

    let holdId = "";
    let expenseId = "";
    await sql.begin(async (tx) => {
      const res = await reserveForExpense(tx, {
        fundId,
        amount: paise(20000),
        description: "Will expire",
      });
      holdId = res.holdId;
      expenseId = res.expenseId;
    });

    expect(await available(sql, fundId)).toBe(40000n);

    await sql.begin(async (tx) => {
      const res = await expireExpense(tx, {
        fundId,
        holdId,
        expenseId,
      });
      expect(res.success).toBe(true);
      expect(res.expiredEvent.type).toBe("expense.expired");
    });

    // Available funds restored
    expect(await available(sql, fundId)).toBe(60000n);
    const balances = await getBalances(sql, fundId);
    expect(balances.pendingSpendPaise).toBe(0n);
  });

  it("prevents duplicate refund of the same donation", async () => {
    const fundId = await createTestFund(sql);
    let donationId = "";

    await sql.begin(async (tx) => {
      const res = await recordDonation(tx, {
        fundId,
        amount: paise(50000),
        reference: "seed-refund-double",
      });
      donationId = (res.pledgeEvent.payload as { donation_id: string }).donation_id;
    });

    // First refund succeeds
    await sql.begin(async (tx) => {
      await recordRefund(tx, {
        fundId,
        donationId,
        amount: paise(50000),
      });
    });

    expect(await balance(sql, fundId)).toBe(0n);

    // Second refund attempt fails
    await expect(
      sql.begin(async (tx) => {
        await recordRefund(tx, {
          fundId,
          donationId,
          amount: paise(50000),
        });
      }),
    ).rejects.toThrow(/already been refunded/i);
  });

  it("Full money flow: donation -> reserve -> settle -> release -> refund with AC2 replay parity", async () => {
    const fundId = await createTestFund(sql);

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
    const fundId = await createTestFund(sql);
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId,
        amount: paise(25000),
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
    const fundA = await createTestFund(sql);
    const fundB = await createTestFund(sql);

    let holdAId = "";
    let expenseAId = "";
    await sql.begin(async (tx) => {
      await recordDonation(tx, {
        fundId: fundA,
        amount: paise(50000),
        reference: "fund-a-seed",
      });
      const res = await reserveForExpense(tx, {
        fundId: fundA,
        amount: paise(20000),
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
