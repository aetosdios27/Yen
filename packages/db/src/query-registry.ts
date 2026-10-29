import type { Sql } from "./client.js";

/**
 * Categories of hot-path queries in Yen.
 * Every hot path (fund reads, membership lookups, event append, donation/expense lists)
 * is listed in ONE registry with its expected plan shape.
 */
export type QueryCategory =
  | "fund_reads"
  | "membership_lookups"
  | "user_lookups"
  | "org_lookups"
  | "idempotency"
  | "waitlist"
  | "event_append"
  | "donation_lists"
  | "expense_lists";

/**
 * Expected query execution plan constraints and cost budget.
 *
 * Source: PostgreSQL 16 Planner Cost Estimation:
 * https://www.postgresql.org/docs/16/using-explain.html
 */
export type ExpectedPlanShape = {
  /** Maximum allowable estimated total cost from EXPLAIN (FORMAT JSON, VERBOSE). */
  maxCost: number;
  /** Primary target table of the query. */
  targetTable: string;
  /** Name of index (or allowed indexes) that must be used in the query plan. */
  expectedIndex?: string | string[];
  /** Disallow sequential scan on the target table. */
  disallowSeqScan: boolean;
  /** Permitted scan node types on the target relation. Default: index and bitmap scans. */
  allowedScanTypes?: string[];
};

/**
 * Sample context IDs provided by dataset seeding for running EXPLAIN queries.
 */
export type SampleQueryContext = {
  userId: string;
  userPhone: string;
  orgId: string;
  orgOwnerId: string;
  fundId: string;
  fundOrgId: string;
  membershipFundId: string;
  membershipUserId: string;
  idempotencyKey: string;
  waitlistContact: string;
  [key: string]: unknown;
};

/**
 * Registered hot-path query definition.
 */
export type RegisteredHotPathQuery = {
  id: string;
  name: string;
  category: QueryCategory;
  sqlTemplate: string;
  explain: (sql: Sql, ctx: SampleQueryContext) => Promise<unknown>;
  expectedPlan: ExpectedPlanShape;
};

const INITIAL_HOT_PATH_QUERIES: RegisteredHotPathQuery[] = [
  {
    id: "fund_read_by_id",
    name: "Fund read by ID",
    category: "fund_reads",
    sqlTemplate:
      "SELECT f.id, f.org_id, f.title, f.target_paise, f.visibility_tier, f.payee_vpa, f.payee_name, f.created_at, f.policy_json, f.version, o.owner_id FROM funds f JOIN orgs o ON o.id = f.org_id WHERE f.id = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT f.id, f.org_id, f.title, f.target_paise, f.visibility_tier, f.payee_vpa, f.payee_name, f.created_at, f.policy_json, f.version, o.owner_id FROM funds f JOIN orgs o ON o.id = f.org_id WHERE f.id = ${ctx.fundId}`,
    expectedPlan: {
      targetTable: "funds",
      expectedIndex: "funds_pkey",
      disallowSeqScan: true,
      maxCost: 17.0,
    },
  },
  {
    id: "funds_read_by_org_id",
    name: "Funds read by organization ID",
    category: "fund_reads",
    sqlTemplate: "SELECT * FROM funds WHERE org_id = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM funds WHERE org_id = ${ctx.fundOrgId}`,
    expectedPlan: {
      targetTable: "funds",
      expectedIndex: "funds_org_id_idx",
      disallowSeqScan: true,
      maxCost: 25.0,
    },
  },
  {
    id: "memberships_read_by_user_id",
    name: "Memberships lookup by user ID",
    category: "membership_lookups",
    sqlTemplate: "SELECT * FROM memberships WHERE user_id = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM memberships WHERE user_id = ${ctx.membershipUserId}`,
    expectedPlan: {
      targetTable: "memberships",
      expectedIndex: "memberships_user_id_idx",
      disallowSeqScan: true,
      maxCost: 25.0,
    },
  },
  {
    id: "membership_read_by_fund_and_user",
    name: "Membership authorization lookup by fund ID and user ID",
    category: "membership_lookups",
    sqlTemplate:
      "SELECT role FROM memberships WHERE fund_id = $1 AND user_id = $2 AND status = 'active'",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT role FROM memberships WHERE fund_id = ${ctx.membershipFundId} AND user_id = ${ctx.membershipUserId} AND status = 'active'`,
    expectedPlan: {
      targetTable: "memberships",
      expectedIndex: ["memberships_pkey", "memberships_user_id_idx"],
      disallowSeqScan: true,
      maxCost: 15.0,
    },
  },
  {
    id: "memberships_read_by_fund_id",
    name: "Fund members list lookup by fund ID",
    category: "membership_lookups",
    sqlTemplate: "SELECT * FROM memberships WHERE fund_id = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM memberships WHERE fund_id = ${ctx.membershipFundId}`,
    expectedPlan: {
      targetTable: "memberships",
      expectedIndex: "memberships_pkey",
      disallowSeqScan: true,
      maxCost: 35.0,
    },
  },
  {
    id: "user_read_by_id",
    name: "User read by primary key ID",
    category: "user_lookups",
    sqlTemplate: "SELECT * FROM users WHERE id = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM users WHERE id = ${ctx.userId}`,
    expectedPlan: {
      targetTable: "users",
      expectedIndex: "users_pkey",
      disallowSeqScan: true,
      maxCost: 15.0,
    },
  },
  {
    id: "user_read_by_phone",
    name: "User lookup by canonical E.164 phone number",
    category: "user_lookups",
    sqlTemplate: "SELECT * FROM users WHERE phone = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM users WHERE phone = ${ctx.userPhone}`,
    expectedPlan: {
      targetTable: "users",
      expectedIndex: "users_phone_key",
      disallowSeqScan: true,
      maxCost: 15.0,
    },
  },
  {
    id: "org_read_by_id",
    name: "Organization read by ID",
    category: "org_lookups",
    sqlTemplate: "SELECT * FROM orgs WHERE id = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM orgs WHERE id = ${ctx.orgId}`,
    expectedPlan: {
      targetTable: "orgs",
      expectedIndex: "orgs_pkey",
      disallowSeqScan: true,
      maxCost: 15.0,
    },
  },
  {
    id: "orgs_read_by_owner_id",
    name: "Organizations read by owner ID",
    category: "org_lookups",
    sqlTemplate: "SELECT * FROM orgs WHERE owner_id = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM orgs WHERE owner_id = ${ctx.orgOwnerId}`,
    expectedPlan: {
      targetTable: "orgs",
      expectedIndex: "orgs_owner_id_idx",
      disallowSeqScan: true,
      maxCost: 25.0,
    },
  },
  {
    id: "idempotency_key_lookup",
    name: "Idempotency key lookup",
    category: "idempotency",
    sqlTemplate: "SELECT * FROM idempotency_keys WHERE key = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM idempotency_keys WHERE key = ${ctx.idempotencyKey}`,
    expectedPlan: {
      targetTable: "idempotency_keys",
      expectedIndex: "idempotency_keys_pkey",
      disallowSeqScan: true,
      maxCost: 15.0,
    },
  },
  {
    id: "waitlist_entry_by_contact",
    name: "Waitlist entry lookup by normalized contact",
    category: "waitlist",
    sqlTemplate: "SELECT * FROM waitlist_entries WHERE contact = $1",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM waitlist_entries WHERE contact = ${ctx.waitlistContact}`,
    expectedPlan: {
      targetTable: "waitlist_entries",
      expectedIndex: "waitlist_entries_contact_key",
      disallowSeqScan: true,
      maxCost: 15.0,
    },
  },
  {
    id: "expenses_list_by_fund",
    name: "Expense list by fund",
    category: "expense_lists",
    sqlTemplate: "SELECT * FROM expenses WHERE fund_id = $1 ORDER BY created_at DESC",
    explain: (sql, ctx) =>
      sql`EXPLAIN (FORMAT JSON, VERBOSE) SELECT * FROM expenses WHERE fund_id = ${ctx.fundId} ORDER BY created_at DESC`,
    expectedPlan: {
      targetTable: "expenses",
      expectedIndex: "expenses_fund_id_created_at_idx",
      disallowSeqScan: true,
      maxCost: 260.0,
    },
  },
];

const dynamicRegistry: RegisteredHotPathQuery[] = [...INITIAL_HOT_PATH_QUERIES];

/**
 * Register a new hot-path query in the registry.
 * Feature PRs (such as event append, donations, expenses) call this or add entries to INITIAL_HOT_PATH_QUERIES.
 */
export function registerHotPathQuery(query: RegisteredHotPathQuery): void {
  const existing = dynamicRegistry.findIndex((candidate) => candidate.id === query.id);
  if (existing >= 0) {
    dynamicRegistry[existing] = query;
  } else {
    dynamicRegistry.push(query);
  }
}

/**
 * Returns all currently registered hot-path queries.
 */
export function getRegisteredHotPathQueries(): readonly RegisteredHotPathQuery[] {
  return dynamicRegistry;
}
