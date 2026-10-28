import { randomUUID } from "node:crypto";
import { createSql } from "./client.ts";
import { parseDatabaseUrl } from "./env.ts";
import { assertForeignKeyIndexes, verifyAllMigrationsForeignKeys } from "./foreign-keys.ts";

async function main() {
  const testUrl = process.env.YEN_TEST_DATABASE_URL;
  const standardUrl = process.env.DATABASE_URL;

  if (testUrl) {
    const adminUrl = parseDatabaseUrl(testUrl, "YEN_TEST_DATABASE_URL");
    const admin = createSql(adminUrl);
    const dbName = `yen_fk_ci_${randomUUID().replaceAll("-", "")}`;
    const testDbUrl = new URL(adminUrl);
    testDbUrl.pathname = `/${dbName}`;
    const testSql = createSql(testDbUrl.toString());

    try {
      await admin`CREATE DATABASE ${admin(dbName)}`;
      process.stdout.write(`Checking foreign-key indexing across all migrations from scratch...\n`);
      const result = await verifyAllMigrationsForeignKeys(testSql);
      process.stdout.write(
        `✓ All ${result.migrationCount} migrations verified: every foreign key has a supporting index.\n`,
      );
    } finally {
      try {
        await testSql.end({ timeout: 5 });
        await admin`DROP DATABASE IF EXISTS ${admin(dbName)} WITH (FORCE)`;
      } finally {
        await admin.end({ timeout: 5 });
      }
    }
  } else if (standardUrl) {
    const dbUrl = parseDatabaseUrl(standardUrl, "DATABASE_URL");
    const sql = createSql(dbUrl);
    try {
      process.stdout.write(
        `Checking foreign-key indexing across all application schemas on database "${new URL(dbUrl).pathname.slice(1)}" at ${new URL(dbUrl).host}...\n`,
      );
      await assertForeignKeyIndexes(sql);
      process.stdout.write(
        `✓ All foreign keys across application schemas have supporting indexes.\n`,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  } else {
    process.stderr.write(
      "Error: YEN_TEST_DATABASE_URL or DATABASE_URL must be set to run foreign key check.\n",
    );
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error during foreign key check: ${error.message}\n`);
  process.exit(1);
});
