import { paise } from "@yen/shared";
import { expect, it } from "vitest";
import { verifyFundState } from "./chaos.js";
import { recordDonation, reserveForExpense, settleExpense } from "./operations.js";
import { createLedgerTestFund, ledgerDatabaseSuite } from "./test/database.js";

ledgerDatabaseSuite("YEN-61 opt-in failure injection", (sql) => {
  it("rolls back a terminated backend during a ledger transaction without orphan entries", async () => {
    const fundId = await createLedgerTestFund(sql);
    await expect(
      sql.begin(async (tx) => {
        const pid = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        const backendPid = Number(pid[0]?.pid);
        await recordDonation(tx, { fundId, amount: paise(50000) });
        await sql`SELECT pg_terminate_backend(${backendPid})`;
      }),
    ).rejects.toThrow();
    await verifyFundState(sql, fundId);
    const rows = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM konto_entries e
      JOIN konto_accounts a ON a.id = e.account_id
      WHERE a.name LIKE ${`fund:${fundId}:%`}
    `;
    expect(rows[0]?.count).toBe(0);
  });

  it("aborts between a direct Konto posting and event append", async () => {
    const fundId = await createLedgerTestFund(sql);
    await expect(
      sql.begin(async (tx) => {
        await recordDonation(tx, { fundId, amount: paise(40000) });
        throw new Error("injected crash before commit after ledger and event writes");
      }),
    ).rejects.toThrow("injected crash");
    const verified = await verifyFundState(sql, fundId);
    expect(verified.events).toHaveLength(0);
    expect(verified.balances.bankPaise).toBe(0n);
  });

  it("serializes competing reserves and preserves the event chain", async () => {
    const fundId = await createLedgerTestFund(sql);
    await sql.begin((tx) => recordDonation(tx, { fundId, amount: paise(50000) }));
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        sql.begin((tx) => reserveForExpense(tx, { fundId, amount: paise(5000) })),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);
    const { balances, events } = await verifyFundState(sql, fundId);
    expect(balances.pendingSpendPaise).toBe(50000n);
    expect(events).toHaveLength(22);
  }, 30_000);

  it("allows a hold to be committed once under concurrent retries", async () => {
    const fundId = await createLedgerTestFund(sql);
    await sql.begin((tx) => recordDonation(tx, { fundId, amount: paise(10000) }));
    let holdId = "";
    let expenseId = "";
    await sql.begin(async (tx) => {
      const held = await reserveForExpense(tx, { fundId, amount: paise(7000) });
      holdId = held.holdId;
      expenseId = held.expenseId;
    });
    const attempts = await Promise.allSettled(
      [1, 2].map(() => sql.begin((tx) => settleExpense(tx, { fundId, holdId, expenseId }))),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const { events, balances } = await verifyFundState(sql, fundId);
    expect(events.filter((event) => event.type === "expense.paid")).toHaveLength(1);
    expect(balances.bankPaise).toBe(3000n);
  });
});
