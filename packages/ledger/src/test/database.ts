import { randomInt, randomUUID } from "node:crypto";
import { createSql, migrate, type Sql, uuidv7 } from "@yen/db";
import { afterAll, beforeAll, describe, it } from "vitest";
import * as z from "zod";
import { initLedgerSchema } from "../schema.js";

const ciSchema = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value === "true" || value === "1");

export async function createTestFund(sql: Sql): Promise<string> {
  const userId = uuidv7();
  const orgId = uuidv7();
  const fundId = uuidv7();
  const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
  await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Test User')`;
  await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Test Org', 'society', ${userId})`;
  await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Test Fund', '{}')`;
  return fundId;
}

export function ledgerDatabaseSuite(name: string, tests: (sql: Sql, url: string) => void): void {
  const ci = ciSchema.safeParse(process.env.CI);
  if (!ci.success) throw new Error("CI must be one of: true, false, 1, 0 (or unset)");
  const rawUrl = process.env.YEN_TEST_DATABASE_URL;

  if (rawUrl === undefined || rawUrl.trim() === "") {
    if (ci.data) {
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
    const dbName = `yen_ledger_test_${randomUUID().replaceAll("-", "")}`;
    const admin = createSql(rawUrl);
    const url = new URL(rawUrl);
    url.pathname = `/${dbName}`;
    const sql = createSql(url.toString());

    beforeAll(async () => {
      await admin`CREATE DATABASE ${admin(dbName)}`;
      // Ledger tests need the app tables too: pledges live in a db-owned table.
      await migrate(sql);
      await initLedgerSchema(sql);

      // In tests, auto-provision referenced funds so fund_events foreign key is satisfied
      await sql.unsafe(`
        CREATE OR REPLACE FUNCTION yen_test_auto_create_fund()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
          v_user_id uuid := '00000000-0000-4000-8000-000000000001';
          v_org_id uuid := '00000000-0000-4000-8000-000000000002';
        BEGIN
          INSERT INTO users (id, phone, display_name)
          VALUES (v_user_id, '+919999999999', 'Test User')
          ON CONFLICT DO NOTHING;

          INSERT INTO orgs (id, name, legal_form, owner_id)
          VALUES (v_org_id, 'Test Org', 'society', v_user_id)
          ON CONFLICT DO NOTHING;

          INSERT INTO funds (id, org_id, title, policy_json)
          VALUES (NEW.fund_id, v_org_id, 'Test Fund', '{}')
          ON CONFLICT DO NOTHING;

          RETURN NEW;
        END;
        $$;

        CREATE TRIGGER a_test_auto_create_fund
        BEFORE INSERT ON fund_events
        FOR EACH ROW EXECUTE FUNCTION yen_test_auto_create_fund();
      `);
    });

    afterAll(async () => {
      try {
        await sql.end({ timeout: 5 });
        await admin`DROP DATABASE IF EXISTS ${admin(dbName)} WITH (FORCE)`;
      } finally {
        await admin.end({ timeout: 5 });
      }
    });

    tests(sql, url.toString());
  });
}

export async function createLedgerTestFund(sql: Sql, fundId = uuidv7()): Promise<string> {
  const userId = uuidv7();
  const orgId = uuidv7();
  const phoneNumber = (
    (BigInt(`0x${userId.replaceAll("-", "")}`) % 900_000_000_000n) +
    100_000_000_000n
  ).toString();
  const phone = `+1${phoneNumber}`;

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO users (id, phone, display_name)
      VALUES (${userId}, ${phone}, 'Ledger test user')
    `;
    await tx`
      INSERT INTO orgs (id, name, legal_form, owner_id)
      VALUES (${orgId}, 'Ledger test organization', 'individual', ${userId})
    `;
    await tx`
      INSERT INTO funds (id, org_id, title, policy_json)
      VALUES (${fundId}, ${orgId}, 'Ledger test fund', '{}'::jsonb)
    `;
  });

  return fundId;
}
