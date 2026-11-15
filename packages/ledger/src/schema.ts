import { LEDGER_SCHEMA_SQL, migrate, type Sql } from "@yen/db";

export async function initLedgerSchema(sql: Sql): Promise<void> {
  await migrate(sql);
  await sql.unsafe(LEDGER_SCHEMA_SQL);
  await sql`SELECT yen_init_konto_totals()`;
}
