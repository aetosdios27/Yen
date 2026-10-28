import { createSql, parseDatabaseUrl, seedDevDatabase } from "@yen/db";
import { formatInr, paise } from "@yen/shared";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/postgres";
  const parsedUrl = parseDatabaseUrl(databaseUrl, "DATABASE_URL");

  process.stdout.write(`Connecting to database at ${new URL(parsedUrl).host}...\n`);
  const sql = createSql(parsedUrl);

  try {
    process.stdout.write("Seeding local development dataset...\n");
    const result = await seedDevDatabase(sql);

    process.stdout.write("\n======================================================\n");
    process.stdout.write(" Yen Local Development Environment Seeded Successfully\n");
    process.stdout.write("======================================================\n\n");

    process.stdout.write(`Organization: ${result.org.name} (${result.org.id})\n`);
    process.stdout.write(`Legal Form:   ${result.org.legalForm}\n\n`);

    process.stdout.write(`Active Fund:  ${result.fund.title} (${result.fund.id})\n`);
    process.stdout.write(`Payee VPA:    ${result.fund.upiVpa}\n`);
    process.stdout.write(`UPI Name:     ${result.fund.upiPayeeName}\n`);
    process.stdout.write(`Target:       ${formatInr(paise(Number(result.fund.targetPaise)))}\n\n`);

    process.stdout.write("------------------------------------------------------\n");
    process.stdout.write(" Seeded Users & Mock Session Personas\n");
    process.stdout.write("------------------------------------------------------\n");
    for (const u of result.users) {
      process.stdout.write(
        `• ${u.displayName.padEnd(16)} | Role: ${u.role.padEnd(10)} | Phone: ${u.phone} | Actor: ${u.actor}\n`,
      );
      process.stdout.write(`  Mock Session: ${u.sessionToken}\n`);
    }

    process.stdout.write("\n------------------------------------------------------\n");
    process.stdout.write(" Expense Requests\n");
    process.stdout.write("------------------------------------------------------\n");
    for (const exp of result.expenses) {
      process.stdout.write(
        `• [${exp.status.toUpperCase().padEnd(9)}] ${formatInr(exp.amountPaise).padEnd(12)} - ${exp.description}\n`,
      );
      if (exp.evidenceId) {
        process.stdout.write(`  Evidence ID: ${exp.evidenceId} (SHA: ${exp.contentSha256})\n`);
      }
      if (exp.bankTransactionId) {
        process.stdout.write(`  Bank Tx: ${exp.bankTransactionId} (UTR: ${exp.utr})\n`);
      }
    }

    process.stdout.write("\n------------------------------------------------------\n");
    process.stdout.write(" Double-Entry Ledger & Append-Only Event Log\n");
    process.stdout.write("------------------------------------------------------\n");
    process.stdout.write(
      `Initial Donations Raised: ${formatInr(result.ledger.initialDonationsPaise)}\n`,
    );
    process.stdout.write(
      `Paid Expenses Disbursed:  ${formatInr(result.ledger.paidExpensesPaise)}\n`,
    );
    process.stdout.write(
      `Verified Current Balance: ${formatInr(result.ledger.currentBalancePaise)}\n`,
    );
    process.stdout.write(
      `Zero-Sum Invariant:       ${result.ledger.isZeroSum ? "VERIFIED (0 sum)" : "FAILED"}\n`,
    );
    process.stdout.write(`Chained Events Appended:  ${result.eventCount} events\n\n`);

    process.stdout.write("Ready for development!\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  process.stderr.write(`Error during database seeding: ${error.message}\n`);
  if (error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(1);
});
