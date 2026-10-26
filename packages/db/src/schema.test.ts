import { parseFundId, parseOrgId, parseUserId } from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import * as z from "zod";
import { migrate } from "./migrate.js";
import {
  fundRowSchema,
  idempotencyKeyRowSchema,
  membershipRowSchema,
  orgRowSchema,
  pseudonymRowSchema,
  userRowSchema,
} from "./rows.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";

databaseSuite("app schema on Postgres 16", (sql) => {
  const userId = uuidv7();
  const orgId = uuidv7();
  const fundId = uuidv7();
  beforeAll(async () => {
    await migrate(sql);
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, '+919000000001', 'Owner')`;
    await sql`
      INSERT INTO orgs (id, name, legal_form, owner_id)
      VALUES (${orgId}, 'Community', 'club', ${userId})
    `;
    await sql`
      INSERT INTO funds (id, org_id, title, policy_json)
      VALUES (${fundId}, ${orgId}, 'Festival', '{}')
    `;
  });

  it("runs against Postgres 16 with UTC sessions and the configured pool defaults", async () => {
    const version = z
      .object({ server_version_num: z.string() })
      .parse((await sql`SHOW server_version_num`)[0]);
    expect(Number(version.server_version_num)).toBeGreaterThanOrEqual(160000);
    expect(Number(version.server_version_num)).toBeLessThan(170000);
    expect(await sql`SHOW TimeZone`).toEqual([{ TimeZone: "UTC" }]);
    expect(sql.options.max).toBe(10);
    expect(sql.options.prepare).toBe(true);
  });

  it("gives every table, including migration history, a primary key", async () => {
    const missing = await sql`
      SELECT t.tablename FROM pg_tables t
      WHERE t.schemaname = 'public' AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = format('%I.%I', t.schemaname, t.tablename)::regclass AND c.contype = 'p'
      )
    `;
    expect(missing).toEqual([]);
  });

  it("requires application UUIDs without column defaults", async () => {
    const defaults = await sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'uuid' AND column_default IS NOT NULL
    `;
    expect(defaults).toEqual([]);
    await expect(
      sql`INSERT INTO users (phone, display_name) VALUES ('missing-id', 'Missing')`,
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("parses database rows into shared branded IDs and preserves defaults", async () => {
    const user = userRowSchema.parse((await sql`SELECT * FROM users WHERE id = ${userId}`)[0]);
    const org = orgRowSchema.parse((await sql`SELECT * FROM orgs WHERE id = ${orgId}`)[0]);
    const fund = fundRowSchema.parse((await sql`SELECT * FROM funds WHERE id = ${fundId}`)[0]);
    expect(parseUserId(user.id)).toEqual({ ok: true, value: user.id });
    expect(parseOrgId(org.id)).toEqual({ ok: true, value: org.id });
    expect(parseFundId(fund.id)).toEqual({ ok: true, value: fund.id });
    expect(user.locale).toBe("en");
    expect(user.created_at).toBeInstanceOf(Date);
    expect(org.owner_id).toBe(user.id);
    expect(fund).toMatchObject({
      org_id: org.id,
      target_paise: null,
      visibility_tier: "donors",
      status: "active",
      policy_json: {},
    });
  });

  it("preserves bigint paise beyond JavaScript's safe integer range", async () => {
    const id = uuidv7();
    await sql`
      INSERT INTO funds (id, org_id, title, target_paise, policy_json)
      VALUES (${id}, ${orgId}, 'Large target', ${9223372036854775807n}, '{}')
    `;
    const fund = fundRowSchema.parse((await sql`SELECT * FROM funds WHERE id = ${id}`)[0]);
    expect(fund.target_paise).toBe(9223372036854775807n);
  });

  it("rejects negative target paise", async () => {
    await expect(sql`
      INSERT INTO funds (id, org_id, title, target_paise, policy_json)
      VALUES (${uuidv7()}, ${orgId}, 'Invalid', -1, '{}')
    `).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects invalid visibility and fund status", async () => {
    await expect(sql`
      INSERT INTO funds (id, org_id, title, visibility_tier, policy_json)
      VALUES (${uuidv7()}, ${orgId}, 'Invalid', 'secret', '{}')
    `).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql`UPDATE funds SET status = 'unknown' WHERE id = ${fundId}`,
    ).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("rejects duplicate phone numbers", async () => {
    await expect(sql`
      INSERT INTO users (id, phone, display_name) VALUES (${uuidv7()}, '+919000000001', 'Duplicate')
    `).rejects.toMatchObject({ code: "23505" });
  });

  it.each([
    "9876543210",
    "+0123456789",
    "+91 98765 43210",
    "+91-9876543210",
    "",
    "+1234567890123456",
  ])("rejects noncanonical phone %j", async (phone) => {
    await expect(sql`
      INSERT INTO users (id, phone, display_name) VALUES (${uuidv7()}, ${phone}, 'Invalid')
    `).rejects.toMatchObject({ code: "23514" });
  });

  it("stores a canonical phone and rejects another spelling of the same number", async () => {
    const id = uuidv7();
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${id}, '+919876543210', 'Valid')`;
    await expect(sql`
      INSERT INTO users (id, phone, display_name)
      VALUES (${uuidv7()}, '+91 98765 43210', 'Duplicate spelling')
    `).rejects.toMatchObject({ code: "23514" });
    expect(await sql`SELECT phone FROM users WHERE id = ${id}`).toEqual([
      { phone: "+919876543210" },
    ]);
  });

  it("enforces org owner and fund org foreign keys", async () => {
    await expect(sql`
      INSERT INTO orgs (id, name, legal_form, owner_id)
      VALUES (${uuidv7()}, 'Invalid', 'club', ${uuidv7()})
    `).rejects.toMatchObject({ code: "23503" });
    await expect(sql`
      INSERT INTO funds (id, org_id, title, policy_json)
      VALUES (${uuidv7()}, ${uuidv7()}, 'Invalid', '{}')
    `).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects membership for a missing fund or user", async () => {
    await expect(sql`
      INSERT INTO memberships (fund_id, user_id, role, status)
      VALUES (${uuidv7()}, ${userId}, 'member', 'active')
    `).rejects.toMatchObject({ code: "23503" });
    await expect(sql`
      INSERT INTO memberships (fund_id, user_id, role, status)
      VALUES (${fundId}, ${uuidv7()}, 'member', 'active')
    `).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects invalid membership roles and statuses", async () => {
    await expect(sql`
      INSERT INTO memberships (fund_id, user_id, role, status)
      VALUES (${fundId}, ${userId}, 'admin', 'active')
    `).rejects.toMatchObject({ code: "23514" });
    await expect(sql`
      INSERT INTO memberships (fund_id, user_id, role, status)
      VALUES (${fundId}, ${userId}, 'member', 'pending')
    `).rejects.toMatchObject({ code: "23514" });
  });

  it("permits multiple roles but rejects a duplicate membership triple", async () => {
    for (const role of ["owner", "treasurer", "approver", "auditor", "member"]) {
      const rows = await sql`
        INSERT INTO memberships (fund_id, user_id, role, status)
        VALUES (${fundId}, ${userId}, ${role}, 'active') RETURNING *
      `;
      expect(membershipRowSchema.parse(rows[0]).role).toBe(role);
    }
    await expect(sql`
      INSERT INTO memberships (fund_id, user_id, role, status)
      VALUES (${fundId}, ${userId}, 'member', 'invited')
    `).rejects.toMatchObject({ code: "23505" });
  });

  it("allows erasing a pseudonym mapping while a historical reference survives", async () => {
    const id = uuidv7();
    const mapping = await sql`
      INSERT INTO pseudonyms (pseudonym_id, user_id) VALUES (${id}, ${userId}) RETURNING *
    `;
    expect(pseudonymRowSchema.parse(mapping[0])).toEqual({ pseudonym_id: id, user_id: userId });
    await expect(sql`
      INSERT INTO pseudonyms (pseudonym_id, user_id) VALUES (${uuidv7()}, ${userId})
    `).rejects.toMatchObject({ code: "23505" });
    await sql`CREATE TABLE historical_reference (id uuid PRIMARY KEY, actor_pseudonym uuid NOT NULL)`;
    await sql`INSERT INTO historical_reference (id, actor_pseudonym) VALUES (${uuidv7()}, ${id})`;
    await sql`DELETE FROM pseudonyms WHERE pseudonym_id = ${id}`;
    expect(await sql`SELECT * FROM pseudonyms WHERE pseudonym_id = ${id}`).toEqual([]);
    expect(await sql`SELECT actor_pseudonym FROM historical_reference`).toEqual([
      { actor_pseudonym: id },
    ]);
  });

  it("stores idempotent responses and rejects duplicate keys", async () => {
    const rows = await sql`
      INSERT INTO idempotency_keys (key, request_hash, response)
      VALUES ('request-1', 'sha256-request', '{"status":201,"body":{"id":"fund"}}') RETURNING *
    `;
    expect(idempotencyKeyRowSchema.parse(rows[0])).toMatchObject({
      key: "request-1",
      request_hash: "sha256-request",
      response: { status: 201, body: { id: "fund" } },
    });
    await expect(sql`
      INSERT INTO idempotency_keys (key, request_hash, response) VALUES ('request-1', 'hash', '{}')
    `).rejects.toMatchObject({ code: "23505" });
  });
});
