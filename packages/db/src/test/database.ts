import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createSql, type Sql } from "../client.js";

export function databaseSuite(name: string, tests: (sql: Sql, url: string) => void): void {
  const adminUrl = process.env.YEN_TEST_DATABASE_URL;
  if (!adminUrl) {
    if (process.env.CI !== undefined) {
      throw new Error("YEN_TEST_DATABASE_URL must point to a Postgres ADMIN connection in CI");
    }
    process.stderr.write(
      `Skipping ${name}: set YEN_TEST_DATABASE_URL to a Postgres 16 ADMIN connection to run DB tests.\n`,
    );
    describe.skip(`${name}: set YEN_TEST_DATABASE_URL to run real Postgres tests`, () => {
      it("requires a Postgres ADMIN connection", () => {});
    });
    return;
  }

  describe(name, () => {
    const name = `yen_test_${randomUUID().replaceAll("-", "")}`;
    const admin = createSql(adminUrl);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    const sql = createSql(url.toString());
    beforeAll(async () => {
      await admin`CREATE DATABASE ${admin(name)}`;
    });
    afterAll(async () => {
      try {
        await sql.end({ timeout: 5 });
        await admin`DROP DATABASE IF EXISTS ${admin(name)} WITH (FORCE)`;
      } finally {
        await admin.end({ timeout: 5 });
      }
    });
    tests(sql, url.toString());
  });
}
