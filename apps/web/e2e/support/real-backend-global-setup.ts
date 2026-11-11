import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSql, seedDevDatabase } from "@yen/db";
import { fundAccountId } from "../../../../packages/ledger/dist/index.js";

const SEED_FUND_ID = "01940000-0000-7000-8000-000000000002";

function workspaceRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      if (readdirSync(join(current, "packages")).includes("ledger")) return current;
    } catch {
      // keep walking up
    }
    current = dirname(current);
  }
  throw new Error("could not locate the repository root from the e2e global setup");
}

function workspaceFile(relativePath: string): string {
  return join(workspaceRoot(dirname(fileURLToPath(import.meta.url))), relativePath);
}

/**
 * Real-backend mode: resets the database behind E2E_DATABASE_URL and seeds the
 * demo dataset exactly like `pnpm db:reset`, with two reconciliations so the
 * runtime ledger works and the first write succeeds:
 * 1. the dev seed hand-rolls minimal konto tables whose rows and column
 *   defaults differ from packages/ledger/src/schema.sql, so runtime transfers
 *   fail and ensureFundAccounts hits the account name unique constraint; the
 *   seed tables are dropped before the full ledger schema lands and the seed's
 *   ledger economics are re-inserted under the runtime's deterministic account
 *   ids.
 * 2. `pnpm db:reset` alone never installs the 0037 ledger totals machinery
 *   (`konto_account_totals`, `yen_konto_available`) because the install hook
 *   skips itself while the konto tables do not exist yet, so every transfer
 *   fails. Applying packages/ledger/src/schema.sql first (the order
 *   packages/db/src/migrate.test.ts blesses) and then invoking the already
 *   installed `yen_init_konto_totals()` hook installs it.
 * 3. the real auth middleware resolves a principal only for sessions with a
 *   trusted device row (what an OTP login establishes); the mock sessions are
 *   marked trusted for 30 days so the seeded persona tokens authenticate.
 * 4. the dev seed verifies donations without the matched bank statement rows
 *   the public summary's raised total derives from, so the fund reads as
 *   spendable zero; matched credits are inserted for every verified pledge.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "E2E_BACKEND=real requires E2E_DATABASE_URL to point at a disposable Postgres database",
    );
  }
  const sql = createSql(databaseUrl);
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO public;");
    const result = await seedDevDatabase(sql);
    await sql.unsafe("DROP TABLE IF EXISTS konto_entries");
    await sql.unsafe("DROP TABLE IF EXISTS konto_journals");
    await sql.unsafe("DROP TABLE IF EXISTS konto_accounts");
    await sql.file(workspaceFile("packages/ledger/src/schema.sql"));
    await sql.unsafe("SELECT yen_init_konto_totals();");
    await sql`
      INSERT INTO konto_accounts (id, name, account_type, currency)
      VALUES
        (${fundAccountId(SEED_FUND_ID, "bank")}, ${`fund:${SEED_FUND_ID}:bank`}, 'ASSET', 'INR'),
        (
          ${fundAccountId(SEED_FUND_ID, "donations")},
          ${`fund:${SEED_FUND_ID}:donations`},
          'REVENUE',
          'INR'
        ),
        (
          ${fundAccountId(SEED_FUND_ID, "expenses")},
          ${`fund:${SEED_FUND_ID}:expenses`},
          'EXPENSE',
          'INR'
        ),
        (
          ${fundAccountId(SEED_FUND_ID, "pending_spend")},
          ${`fund:${SEED_FUND_ID}:pending_spend`},
          'LIABILITY',
          'INR'
        )
    `;
    await sql`
      INSERT INTO konto_journals (account_id, description, idempotency_key)
      VALUES
        (${fundAccountId(SEED_FUND_ID, "bank")}, 'Initial donor verified contributions', 'seed_donations_batch_1'),
        (${fundAccountId(SEED_FUND_ID, "expenses")}, 'Disbursement for RoboCup Asia registration', 'seed_expense_paid_1')
    `;
    await sql`
      INSERT INTO konto_entries (journal_id, account_id, amount)
      SELECT j.id, a.id, e.amount
      FROM (
        VALUES
          ('seed_donations_batch_1', 'bank', 50000000::bigint),
          ('seed_donations_batch_1', 'donations', (-50000000)::bigint),
          ('seed_expense_paid_1', 'expenses', 3500000::bigint),
          ('seed_expense_paid_1', 'bank', (-3500000)::bigint)
      ) AS e(journal_key, account_kind, amount)
      JOIN konto_journals j ON j.idempotency_key = e.journal_key
      JOIN konto_accounts a
        ON a.name = ${`fund:${SEED_FUND_ID}:`}::text || e.account_kind::text
    `;
    await sql`
      INSERT INTO trusted_devices (session_id, user_id, trusted_at, last_active_at, idle_expires_at)
      SELECT id, user_id, NOW(), NOW(), NOW() + interval '30 days'
      FROM sessions
      WHERE revoked_at IS NULL AND expires_at > NOW()
    `;
    await sql`
      UPDATE funds
      SET payee_vpa = 'iitd.robotics@sbi', payee_name = 'IIT Delhi Robotics Club',
        policy_json = jsonb_set(
          COALESCE(policy_json::jsonb, '{}'::jsonb),
          '{objectionWindowHours}',
          '0'
        )
      WHERE id = ${SEED_FUND_ID}
    `;
    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, utr, amount_paise, type, posted_at, source,
        raw_payload, raw_payload_sha256, reconciliation_status, matched_pledge_id,
        matched_at, match_method, match_confidence
      )
      SELECT
        gen_random_uuid(), dp.fund_id, 'seed-' || dp.utr, dp.utr, dp.amount_paise,
        'credit', dp.verified_at, 'statement_upload', '{}'::jsonb, repeat('0', 64),
        'matched', dp.id, dp.verified_at, 'exact_utr', 1.00
      FROM donation_pledges dp
      WHERE dp.status = 'verified' AND dp.verified_at IS NOT NULL
    `;
    process.stdout.write(
      `e2e real backend seeded: fund ${result.fund.id}, ${result.users.length} sessions, ${result.eventCount} events\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
