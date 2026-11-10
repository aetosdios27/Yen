#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createSql, migrate, uuidv7 } from "@yen/db";
import { ensureFundAccounts, recordDonation, reserveForExpense } from "@yen/ledger";
import { paise } from "@yen/shared";
import { initLedgerSchema } from "../dist/schema.js";

const phase = process.argv[2];
if (!["before", "after"].includes(phase)) throw new Error("Expected before or after");
const output = process.argv[3];
if (!output) throw new Error("Expected evidence directory");
await mkdir(output, { recursive: true });
const url = process.env.YEN_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Set YEN_TEST_DATABASE_URL to a disposable database; this probe drops its public schema",
  );
const sql = createSql(url, { max: 1 });
try {
  for (const rows of [10000, 50000, 100000]) {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    if (phase === "before") {
      if (!process.argv[4] || !process.argv[5])
        throw new Error("Before requires old schema and migration directory");
      await migrate(sql, { dir: process.argv[5] });
      await sql.unsafe(await readFile(process.argv[4], "utf8"));
    } else {
      await initLedgerSchema(sql);
    }
    await sql`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`;
    const user = uuidv7();
    const org = uuidv7();
    const fund = uuidv7();
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${user}, '+199999999999', 'Cost fixture')`;
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${org}, 'Cost fixture', 'individual', ${user})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fund}, ${org}, 'Cost fixture', '{}')`;
    const accounts = await ensureFundAccounts(sql, fund);
    await sql`CREATE INDEX IF NOT EXISTS idx_entries_journal ON konto_entries(journal_id)`;
    await sql.begin(async (tx) => {
      await tx`INSERT INTO konto_journals (account_id) SELECT ${accounts.bankId} FROM generate_series(1, ${rows / 2})`;
      await tx`INSERT INTO konto_entries (entry_sequence, journal_id, account_id, amount)
        SELECT 0, j.id, v.account_id, v.amount FROM konto_journals j
        CROSS JOIN (VALUES (${accounts.bankId}::uuid, 1000), (${accounts.donationsId}::uuid, -1000)) v(account_id, amount)`;
    });
    await sql`INSERT INTO konto_holds (account_id, recipient_id, amount)
      SELECT ${accounts.bankId}, ${accounts.expensesId}, 1 FROM generate_series(1, ${rows / 8})`;
    if (phase === "before") await sql`DROP INDEX idx_entries_journal`;
    await sql`ANALYZE konto_entries`;
    await sql`ANALYZE konto_holds`;
    const journal = (await sql`SELECT id FROM konto_journals LIMIT 1`)[0].id;
    const plans = {};
    plans.journal = await sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT COALESCE(SUM(amount), 0) FROM konto_entries WHERE journal_id = ${journal}`;
    if (phase === "before") {
      plans.entries = await sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT SUM(amount) FROM konto_entries WHERE account_id = ${accounts.bankId}`;
      plans.holds = await sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT SUM(amount) FROM konto_holds WHERE account_id = ${accounts.bankId}
          AND status = 'PENDING' AND (expires_at IS NULL OR NOW() <= expires_at)`;
    } else {
      plans.totals = await sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT entries_total - pending_nonexpiring FROM konto_account_totals WHERE account_id = ${accounts.bankId}`;
      plans.holds = await sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT SUM(amount) FROM konto_holds WHERE account_id = ${accounts.bankId}
          AND status = 'PENDING' AND expires_at IS NOT NULL AND expires_at >= NOW()`;
      plans.available = await sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT yen_konto_available(${accounts.bankId})`;
    }
    plans.batch = await sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT a.name, e.journal_id, e.amount::text,
        SUM(e.amount) OVER (PARTITION BY e.journal_id)::text AS journal_total
      FROM konto_entries e JOIN konto_accounts a ON a.id = e.account_id
      WHERE e.entry_sequence > ${rows - 160}
        AND a.name IN (${`fund:${fund}:bank`}, ${`fund:${fund}:donations`}) ORDER BY e.entry_sequence`;
    await writeFile(`${output}/${phase}-${rows}-plans.json`, JSON.stringify(plans, null, 2));
    await sql`SELECT pg_stat_statements_reset()`;
    const loadBefore = (await readFile("/proc/loadavg", "utf8")).trim();
    for (let completed = 0; completed < 5000; completed += 100) {
      await sql.begin(async (tx) => {
        for (let offset = 0; offset < 100; offset += 1) {
          if ((completed + offset) % 5 === 0) {
            await reserveForExpense(tx, { fundId: fund, amount: paise(1) });
          } else {
            await recordDonation(tx, {
              fundId: fund,
              amount: paise(1000),
              donationId: uuidv7(),
              bankTransactionId: uuidv7(),
            });
          }
        }
      });
    }
    const stats =
      await sql`SELECT query, calls::text, rows::text, shared_blks_hit::text, shared_blks_read::text
      FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND query NOT LIKE '%pg_stat_statements%' ORDER BY query`;
    const loadAfter = (await readFile("/proc/loadavg", "utf8")).trim();
    await writeFile(
      `${output}/${phase}-${rows}-statements.json`,
      JSON.stringify({ rows, operations: 5000, loadBefore, loadAfter, stats }, null, 2),
    );
    await appendFile(
      `${output}/progress.log`,
      `${phase} rows=${rows} ops=5000 load_before=${loadBefore} load_after=${loadAfter}\n`,
    );
    process.stdout.write(`${phase} rows=${rows} ops=5000 captured\n`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
