import * as z from "zod";
import type { Sql } from "./client.js";
import type { SampleQueryContext } from "./query-registry.js";

/**
 * Realistic dataset seeding for query-plan discipline and EXPLAIN budget testing.
 *
 * Sizing justification:
 * - 120,000 users, 120,000 memberships, 150,000 idempotency keys, 120,000 waitlist entries:
 *   Surpasses the 100,000-row threshold so the PostgreSQL optimizer (cost model)
 *   will never consider a Sequential Scan competitive with an Index Scan on hot paths.
 * - 10,000 organizations and 20,000 funds:
 *   Provides thousands of funds with realistic multi-tenant distribution (2 funds per org,
 *   6 distinct members per fund) without exceeding CI time limits (~5-8s seed duration).
 * - ANALYZE is executed immediately after bulk load so pg_statistic and relpages reflect real distribution.
 *
 * Source: PostgreSQL 16 ANALYZE and Planner Statistics:
 * https://www.postgresql.org/docs/16/sql-analyze.html
 * https://www.postgresql.org/docs/16/planner-stats.html
 */

export type SeedStats = {
  users: number;
  pseudonyms: number;
  orgs: number;
  funds: number;
  memberships: number;
  idempotencyKeys: number;
  waitlistEntries: number;
  totalRows: number;
};

export async function seedRealisticDataset(sql: Sql): Promise<{
  stats: SeedStats;
  context: SampleQueryContext;
  tableRowCounts: Record<string, number>;
}> {
  // Execute bulk generation in ordered batches to maintain referential integrity.
  await sql.unsafe(`
    -- 120,000 users
    INSERT INTO users (id, phone, display_name)
    SELECT
      gen_random_uuid(),
      '+919' || lpad(g::text, 9, '0'),
      'User ' || g
    FROM generate_series(1, 120000) g;

    -- 120,000 pseudonym mappings
    INSERT INTO pseudonyms (pseudonym_id, user_id)
    SELECT gen_random_uuid(), id FROM users;

    -- 10,000 organizations (thousands of orgs)
    INSERT INTO orgs (id, name, legal_form, owner_id)
    SELECT
      gen_random_uuid(),
      'Community Org ' || g,
      'society',
      u.id
    FROM (SELECT id, row_number() OVER () AS rn FROM users LIMIT 10000) u
    JOIN generate_series(1, 10000) g ON g = u.rn;

    -- 20,000 funds (thousands of funds, 2 per org)
    INSERT INTO funds (id, org_id, title, policy_json)
    SELECT
      gen_random_uuid(),
      o.id,
      'Relief Fund ' || g,
      '{}'::jsonb
    FROM (SELECT id, row_number() OVER () AS rn FROM orgs LIMIT 10000) o
    CROSS JOIN (SELECT 1 AS num UNION ALL SELECT 2) c
    JOIN generate_series(1, 20000) g ON g = (o.rn - 1) * 2 + c.num;

    -- 120,000 memberships (6 members per fund cleanly distributed across 120,000 users)
    INSERT INTO memberships (fund_id, user_id, role, status)
    SELECT
      f.id,
      u.id,
      'member',
      'active'
    FROM (
      SELECT id, ((row_number() OVER () - 1) * 6)::int AS base_user_idx
      FROM funds
    ) f
    CROSS JOIN generate_series(1, 6) offset_idx
    JOIN (
      SELECT id, (row_number() OVER () - 1)::int AS u_idx
      FROM users
    ) u ON u.u_idx = (f.base_user_idx + offset_idx) % 120000;

    -- 150,000 idempotency keys
    INSERT INTO idempotency_keys (key, request_hash, response)
    SELECT
      'idem_key_' || g,
      'sha256_hash_' || g,
      '{"status":200}'::jsonb
    FROM generate_series(1, 150000) g;

    -- 120,000 waitlist entries
    INSERT INTO waitlist_entries (id, name, contact_kind, contact, org, locale, consent_text, consent_version)
    SELECT
      gen_random_uuid(),
      'Applicant ' || g,
      'email',
      'applicant_' || g || '@example.com',
      'Club ' || g,
      'en',
      'Consent to terms v1',
      'v1'
    FROM generate_series(1, 120000) g;
  `);

  // Run ANALYZE so PostgreSQL planner statistics (reltuples, relpages, MCV lists) are real.
  await sql.unsafe("ANALYZE");

  // Query actual table row counts from pg_stat_user_tables / count
  const countsRows = await sql`
    SELECT relname, n_live_tup::int AS count
    FROM pg_stat_user_tables
    WHERE schemaname = 'public';
  `;
  const countsParsed = z
    .array(z.object({ relname: z.string(), count: z.number() }))
    .parse(countsRows);

  const tableRowCounts: Record<string, number> = {};
  for (const row of countsParsed) {
    tableRowCounts[row.relname] = row.count;
  }

  const stats: SeedStats = {
    users: tableRowCounts.users ?? 120000,
    pseudonyms: tableRowCounts.pseudonyms ?? 120000,
    orgs: tableRowCounts.orgs ?? 10000,
    funds: tableRowCounts.funds ?? 20000,
    memberships: tableRowCounts.memberships ?? 120000,
    idempotencyKeys: tableRowCounts.idempotency_keys ?? 150000,
    waitlistEntries: tableRowCounts.waitlist_entries ?? 120000,
    totalRows: Object.values(tableRowCounts).reduce((acc, c) => acc + c, 0),
  };

  // Extract representative sample IDs to populate SampleQueryContext
  const sampleUser = (await sql`SELECT id, phone FROM users LIMIT 1`)[0];
  const sampleOrg = (await sql`SELECT id, owner_id FROM orgs LIMIT 1`)[0];
  const sampleFund = (await sql`SELECT id, org_id FROM funds LIMIT 1`)[0];
  const sampleMember = (await sql`SELECT fund_id, user_id FROM memberships LIMIT 1`)[0];
  const sampleKey = (await sql`SELECT key FROM idempotency_keys LIMIT 1`)[0];
  const sampleWaitlist = (await sql`SELECT contact FROM waitlist_entries LIMIT 1`)[0];

  const context: SampleQueryContext = {
    userId: String(sampleUser?.id),
    userPhone: String(sampleUser?.phone),
    orgId: String(sampleOrg?.id),
    orgOwnerId: String(sampleOrg?.owner_id),
    fundId: String(sampleFund?.id),
    fundOrgId: String(sampleFund?.org_id),
    membershipFundId: String(sampleMember?.fund_id),
    membershipUserId: String(sampleMember?.user_id),
    idempotencyKey: String(sampleKey?.key),
    waitlistContact: String(sampleWaitlist?.contact),
  };

  return { stats, context, tableRowCounts };
}
