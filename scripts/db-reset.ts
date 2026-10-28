import { createSql, parseDatabaseUrl, seedDevDatabase } from "@yen/db";
import { formatInr } from "@yen/shared";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/postgres";
  const parsedUrl = parseDatabaseUrl(databaseUrl, "DATABASE_URL");

  process.stdout.write(`Resetting database at ${new URL(parsedUrl).host}...\n`);
  const sql = createSql(parsedUrl);

  try {
    process.stdout.write("1. Tearing down schema...\n");
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO public;");

    process.stdout.write("2. Running migrations from scratch...\n");
    // seedDevDatabase automatically executes migrate(sql)
    const result = await seedDevDatabase(sql);

    process.stdout.write("3. Reseeding demo dataset...\n");
    process.stdout.write("\n======================================================\n");
    process.stdout.write(" Database Reset & Reseed Complete\n");
    process.stdout.write("======================================================\n");
    process.stdout.write(`Organization:    ${result.org.name}\n`);
    process.stdout.write(`Active Fund:     ${result.fund.title} (VPA: ${result.fund.upiVpa})\n`);
    process.stdout.write(
      `Seeded Users:    ${result.users.length} users with active mock sessions\n`,
    );
    process.stdout.write(
      `Expenses:        ${result.expenses.length} expense requests (approved, pending, paid)\n`,
    );
    process.stdout.write(
      `Ledger Balance:  ${formatInr(result.ledger.currentBalancePaise)} (Zero-Sum Verified)\n`,
    );
    process.stdout.write(`Chained Events:  ${result.eventCount} immutable audit events\n`);
    process.stdout.write("======================================================\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  process.stderr.write(`Error during database reset: ${error.message}\n`);
  if (error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(1);
});
