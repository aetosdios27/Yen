import { expect, it } from "vitest";
import * as z from "zod";
import { ledgerDatabaseSuite } from "./test/database.js";

const explainSchema = z.tuple([
  z.object({
    "QUERY PLAN": z.tuple([
      z.object({ Plan: z.object({ "Total Cost": z.number() }).passthrough() }),
    ]),
  }),
]);

ledgerDatabaseSuite("journal balance query budget", (sql) => {
  it("checks one journal with an index and fixed cost on a large ledger", async () => {
    const rollback = new Error("roll back plan fixture before deferred checks");
    await expect(
      sql.begin(async (tx) => {
        const accounts = await tx`
          INSERT INTO konto_accounts (name, currency) VALUES ('plan-budget', 'INR') RETURNING id
        `;
        const accountId = accounts[0]?.id;
        const journals = await tx`
          INSERT INTO konto_journals (account_id)
          SELECT ${accountId} FROM generate_series(1, 60000) RETURNING id
        `;
        await tx`
          INSERT INTO konto_entries (entry_sequence, journal_id, account_id, amount)
          SELECT 0, j.id, ${accountId}, amount
          FROM konto_journals j CROSS JOIN (VALUES (1), (-1)) AS amounts(amount)
          WHERE j.account_id = ${accountId}
        `;
        await tx`ANALYZE konto_entries`;
        const plans = await tx`
          EXPLAIN (FORMAT JSON) SELECT COALESCE(SUM(amount), 0)
          FROM konto_entries WHERE journal_id = ${journals[30000]?.id}
        `;
        const plan = explainSchema.parse(plans)[0]["QUERY PLAN"][0].Plan;
        expect(plan["Total Cost"]).toBeLessThan(20);
        expect(JSON.stringify(plan)).toContain("idx_entries_journal");
        expect(JSON.stringify(plan)).not.toContain("Seq Scan");
        await tx`
          INSERT INTO konto_holds (account_id, recipient_id, amount)
          SELECT ${accountId}, ${accountId}, 1 FROM generate_series(1, 120000)
        `;
        await tx`ANALYZE konto_holds`;
        const holdPlans = await tx`
          EXPLAIN (FORMAT JSON) SELECT SUM(amount) FROM konto_holds
          WHERE account_id = ${accountId} AND status = 'PENDING'
            AND expires_at IS NOT NULL AND expires_at >= NOW()
        `;
        const holdPlan = explainSchema.parse(holdPlans)[0]["QUERY PLAN"][0].Plan;
        expect(holdPlan["Total Cost"]).toBeLessThan(20);
        expect(JSON.stringify(holdPlan)).toContain("idx_holds_expiring");
        expect(JSON.stringify(holdPlan)).not.toContain("Seq Scan");
        const totals = await tx`SELECT yen_konto_available(${accountId})::text AS available`;
        expect(totals[0]?.available).toBe("-120000");
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }, 60000);
});

ledgerDatabaseSuite("incremental account totals", (sql) => {
  it("matches entry and pending hold sums across rollback, commit, expiry and deletion", async () => {
    const accounts = await sql`
      INSERT INTO konto_accounts (name, currency)
      VALUES ('totals-bank', 'INR'), ('totals-recipient', 'INR') RETURNING id
    `;
    const bank = accounts[0]?.id;
    const recipient = accounts[1]?.id;
    async function check() {
      const rows = await sql`
        SELECT yen_konto_available(${bank})::text AS actual,
          (COALESCE((SELECT SUM(amount) FROM konto_entries WHERE account_id = ${bank}), 0)
          - COALESCE((SELECT SUM(amount) FROM konto_holds WHERE account_id = ${bank}
            AND status = 'PENDING' AND (expires_at IS NULL OR expires_at >= NOW())), 0))::text AS expected
      `;
      expect(rows[0]?.actual).toBe(rows[0]?.expected);
    }
    await sql.begin(async (tx) => {
      const journals =
        await tx`INSERT INTO konto_journals (account_id) VALUES (${bank}) RETURNING id`;
      await tx`INSERT INTO konto_entries (entry_sequence, journal_id, account_id, amount)
        VALUES (0, ${journals[0]?.id}, ${bank}, 1000), (0, ${journals[0]?.id}, ${recipient}, -1000)`;
    });
    await check();
    await expect(
      sql.begin(async (tx) => {
        const journals =
          await tx`INSERT INTO konto_journals (account_id) VALUES (${bank}) RETURNING id`;
        await tx`INSERT INTO konto_entries (entry_sequence, journal_id, account_id, amount)
        VALUES (0, ${journals[0]?.id}, ${bank}, 200)`;
      }),
    ).rejects.toThrow("unbalanced");
    await check();
    const holds = await sql`
      INSERT INTO konto_holds (account_id, recipient_id, amount, expires_at)
      VALUES (${bank}, ${recipient}, 50, NULL),
        (${bank}, ${recipient}, 70, NOW() + interval '1 hour'),
        (${bank}, ${recipient}, 90, NOW() - interval '1 hour') RETURNING id
    `;
    await check();
    const excluded =
      await sql`SELECT yen_konto_available(${bank}, ${holds[0]?.id})::text AS available`;
    expect(excluded[0]?.available).toBe("930");
    await sql`UPDATE konto_holds SET status = 'COMMITTED' WHERE id = ${holds[0]?.id}`;
    await check();
    await sql`UPDATE konto_holds SET expires_at = NULL WHERE id = ${holds[1]?.id}`;
    await check();
    const rollback = new Error("rollback total update");
    await expect(
      sql.begin(async (tx) => {
        await tx`UPDATE konto_holds SET amount = 123 WHERE id = ${holds[1]?.id}`;
        const journals =
          await tx`INSERT INTO konto_journals (account_id) VALUES (${bank}) RETURNING id`;
        await tx`INSERT INTO konto_entries (entry_sequence, journal_id, account_id, amount)
        VALUES (0, ${journals[0]?.id}, ${bank}, 200), (0, ${journals[0]?.id}, ${recipient}, -200)`;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await check();
    await sql`DELETE FROM konto_holds WHERE account_id = ${bank}`;
    await check();
    await sql`INSERT INTO konto_holds (account_id, recipient_id, amount) VALUES (${bank}, ${recipient}, 75)`;
    await expect(
      sql.begin(async (tx) => {
        await tx`TRUNCATE konto_holds`;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await check();
    await sql`TRUNCATE konto_holds`;
    await check();
  });
});
