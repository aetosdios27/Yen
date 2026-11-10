import { createSql, seedDevDatabase } from "@yen/db";

/**
 * Real-backend mode: resets the database behind E2E_DATABASE_URL and seeds the
 * demo dataset (fund, personas, mock sessions) exactly like `pnpm db:reset`,
 * then reports the seeded fund and sessions to the test process log.
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
    process.stdout.write(
      `e2e real backend seeded: fund ${result.fund.id}, ${result.users.length} sessions, ${result.eventCount} events\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
