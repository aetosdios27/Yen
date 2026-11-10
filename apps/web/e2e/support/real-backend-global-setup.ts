import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSql, seedDevDatabase } from "@yen/db";

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

async function applyLedgerSchema(sql: ReturnType<typeof createSql>): Promise<void> {
  const schemaPath = join(
    workspaceRoot(dirname(fileURLToPath(import.meta.url))),
    "packages/ledger/src/schema.sql",
  );
  await sql.file(schemaPath);
}

/**
 * Real-backend mode: resets the database behind E2E_DATABASE_URL and seeds the
 * demo dataset exactly like `pnpm db:reset`, then reconciles two seed/runtime
 * gaps that would otherwise break the first ledger write:
 * 1. the dev seed hand-rolls konto rows with ids that differ from the runtime's
 *    deterministic account ids, so ensureFundAccounts hits the account name
 *    unique constraint; the rows are removed and recreated by the runtime.
 * 2. the dev seed does not create konto_holds, konto_balance_snapshots or
 *    konto_staged_intents, so the approval hold path would fail.
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
    await sql.unsafe("DELETE FROM konto_entries");
    await sql.unsafe("DELETE FROM konto_journals");
    await sql.unsafe("DELETE FROM konto_accounts");
    await applyLedgerSchema(sql);
    await sql`
      UPDATE funds
      SET payee_vpa = 'iitd.robotics@sbi', payee_name = 'IIT Delhi Robotics Club'
      WHERE id = ${SEED_FUND_ID}
    `;
    process.stdout.write(
      `e2e real backend seeded: fund ${result.fund.id}, ${result.users.length} sessions, ${result.eventCount} events\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
