import { beforeAll, expect, it } from "vitest";
import { migrate } from "./migrate.js";
import {
  assertAllRegisteredQueryPlans,
  explainQuery,
  getTableEstimatedRowCounts,
  type PlanExplanation,
  verifyPlanNode,
} from "./query-plan.js";
import {
  getRegisteredHotPathQueries,
  type RegisteredHotPathQuery,
  type SampleQueryContext,
} from "./query-registry.js";
import { type SeedStats, seedRealisticDataset } from "./seed.js";
import { databaseSuite } from "./test/database.js";

databaseSuite("query-plan discipline and EXPLAIN budgets", (sql) => {
  let seedStats: SeedStats;
  let queryContext: SampleQueryContext;
  let tableRowCounts: Record<string, number>;

  beforeAll(async () => {
    await migrate(sql);
    const seeded = await seedRealisticDataset(sql);
    seedStats = seeded.stats;
    queryContext = seeded.context;
    tableRowCounts = seeded.tableRowCounts;
  }, 60000);

  it("seeds a realistic dataset with thousands of funds and large tables exceeding 100k rows", () => {
    expect(seedStats.funds).toBeGreaterThanOrEqual(2000);
    expect(seedStats.orgs).toBeGreaterThanOrEqual(1000);
    expect(seedStats.users).toBeGreaterThanOrEqual(100000);
    expect(seedStats.memberships).toBeGreaterThanOrEqual(100000);
    expect(seedStats.waitlistEntries).toBeGreaterThanOrEqual(100000);
    expect(seedStats.idempotencyKeys).toBeGreaterThanOrEqual(100000);
  });

  it("verifies every registered hot-path query satisfies its expected plan shape and cost budget", async () => {
    const results = await assertAllRegisteredQueryPlans(sql, queryContext, tableRowCounts);
    expect(results.length).toBeGreaterThanOrEqual(10);
    for (const res of results) {
      expect(res.passed).toBe(true);
      expect(res.violations).toEqual([]);
      expect(res.actualCost).toBeLessThanOrEqual(res.maxCostBudget);
    }
  });

  it("acceptance criterion: no registered hot-path query does a sequential scan on a table over 100k rows", async () => {
    const queries = getRegisteredHotPathQueries();
    for (const query of queries) {
      const explanation = await explainQuery(sql, query, queryContext);
      const result = verifyPlanNode(explanation, tableRowCounts);
      const largeTableSeqScans = result.violations.filter((v) => v.kind === "seq_scan_large_table");
      expect(largeTableSeqScans).toEqual([]);
    }
  });

  it("acceptance criterion: dropping an index in a test migration turns the plan test red", async () => {
    // Drop the supporting index on memberships(user_id)
    await sql`DROP INDEX memberships_user_id_idx`;

    try {
      const query = getRegisteredHotPathQueries().find(
        (q) => q.id === "memberships_read_by_user_id",
      );
      expect(query).toBeDefined();
      if (!query) return;

      const explanation = await explainQuery(sql, query, queryContext);
      const result = verifyPlanNode(explanation, tableRowCounts);

      // Verify the plan test turned red
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);

      // Verify specific guards failed: seq scan forbidden on memberships, seq scan on >100k table, missing index, cost budget
      const kinds = result.violations.map((v) => v.kind);
      expect(kinds).toContain("seq_scan_forbidden");
      expect(kinds).toContain("seq_scan_large_table");
      expect(kinds).toContain("missing_expected_index");
      expect(kinds).toContain("cost_budget");

      // Verify actual cost blew past budget (e.g. from ~8 to >2500)
      expect(result.actualCost).toBeGreaterThan(query.expectedPlan.maxCost);
    } finally {
      // Re-create the index and re-analyze so following tests are pristine
      await sql`CREATE INDEX memberships_user_id_idx ON memberships(user_id)`;
      await sql`ANALYZE memberships`;
    }
  });

  it("mutation check: seq-scan guard triggers when an unindexed column is queried on a >100k row table", async () => {
    const unindexedQuery: RegisteredHotPathQuery = {
      id: "unindexed_user_scan",
      name: "Scan users by unindexed display name",
      category: "user_lookups",
      sqlTemplate: "SELECT * FROM users WHERE display_name = $1",
      explain: (s, _ctx) =>
        s`EXPLAIN (FORMAT JSON) SELECT * FROM users WHERE display_name = 'Nonexistent'`,
      expectedPlan: {
        targetTable: "users",
        disallowSeqScan: true,
        maxCost: 10.0,
      },
    };

    const explanation = await explainQuery(sql, unindexedQuery, queryContext);
    const result = verifyPlanNode(explanation, tableRowCounts);

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.kind === "seq_scan_forbidden")).toBe(true);
    expect(result.violations.some((v) => v.kind === "seq_scan_large_table")).toBe(true);
  });

  it("mutation check: cost budget guard triggers when estimated cost exceeds configured ceiling", async () => {
    const tightBudgetQuery: RegisteredHotPathQuery = {
      id: "tight_budget_fund",
      name: "Fund read with artificially unachievable cost budget",
      category: "fund_reads",
      sqlTemplate: "SELECT * FROM funds WHERE id = $1",
      explain: (s, ctx) => s`EXPLAIN (FORMAT JSON) SELECT * FROM funds WHERE id = ${ctx.fundId}`,
      expectedPlan: {
        targetTable: "funds",
        expectedIndex: "funds_pkey",
        disallowSeqScan: true,
        maxCost: 0.1, // Artificially low budget (actual is ~8.30)
      },
    };

    const explanation = await explainQuery(sql, tightBudgetQuery, queryContext);
    const result = verifyPlanNode(explanation, tableRowCounts);

    expect(result.passed).toBe(false);
    const costViolation = result.violations.find((v) => v.kind === "cost_budget");
    expect(costViolation).toBeDefined();
    expect(costViolation?.actualCost).toBeGreaterThan(0.1);
  });

  it("rejects backup-named or substring-matching index when query expects exact index name", () => {
    const query: RegisteredHotPathQuery = {
      id: "funds_exact_index_check",
      name: "Funds exact index check",
      category: "fund_reads",
      sqlTemplate: "SELECT * FROM funds WHERE org_id = $1",
      explain: (s) => s`EXPLAIN (FORMAT JSON) SELECT 1`,
      expectedPlan: {
        targetTable: "funds",
        expectedIndex: "funds_org_id_idx",
        disallowSeqScan: true,
        maxCost: 100.0,
      },
    };

    const mockExplanation: PlanExplanation = {
      query,
      rootPlan: {
        "Node Type": "Index Scan",
        "Relation Name": "funds",
        "Index Name": "funds_org_id_idx_backup",
        "Total Cost": 5.0,
        "Startup Cost": 0.0,
        "Plan Rows": 1,
      },
      allNodes: [
        {
          "Node Type": "Index Scan",
          "Relation Name": "funds",
          "Index Name": "funds_org_id_idx_backup",
          "Total Cost": 5.0,
          "Startup Cost": 0.0,
          "Plan Rows": 1,
        },
      ],
    };

    const result = verifyPlanNode(mockExplanation, tableRowCounts);
    expect(result.passed).toBe(false);
    const violation = result.violations.find((v) => v.kind === "missing_expected_index");
    expect(violation).toBeDefined();
    expect(violation?.actualIndex).toContain("funds_org_id_idx_backup");
  });

  it("fails verification with missing_table_row_count when scanned relation row count is omitted", () => {
    const query: RegisteredHotPathQuery = {
      id: "scan_without_count",
      name: "Scan without provided count",
      category: "user_lookups",
      sqlTemplate: "SELECT * FROM users",
      explain: (s) => s`EXPLAIN (FORMAT JSON) SELECT 1`,
      expectedPlan: {
        targetTable: "users",
        disallowSeqScan: false,
        maxCost: 1000.0,
      },
    };

    const mockExplanation: PlanExplanation = {
      query,
      rootPlan: {
        "Node Type": "Seq Scan",
        "Relation Name": "users",
        "Total Cost": 10.0,
        "Startup Cost": 0.0,
        "Plan Rows": 50,
      },
      allNodes: [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "users",
          "Total Cost": 10.0,
          "Startup Cost": 0.0,
          "Plan Rows": 50,
        },
      ],
    };

    const result = verifyPlanNode(mockExplanation, {});
    expect(result.passed).toBe(false);
    const violation = result.violations.find((v) => v.kind === "missing_table_row_count");
    expect(violation).toBeDefined();
    expect(violation?.message).toContain("no row count was provided in tableRowCounts");
  });

  it("reads realistic row counts from pg_class.reltuples via getTableEstimatedRowCounts", async () => {
    const counts = await getTableEstimatedRowCounts(sql);
    expect(counts.users).toBeGreaterThanOrEqual(100000);
    expect(counts["public.users"]).toBeGreaterThanOrEqual(100000);
    expect(counts.funds).toBeGreaterThanOrEqual(2000);
  });

  it("enforces allowedScanTypes on target table and rejects disallowed scan types", () => {
    const query: RegisteredHotPathQuery = {
      id: "scan_type_restricted_query",
      name: "Query requiring Index Only Scan",
      category: "fund_reads",
      sqlTemplate: "SELECT id FROM funds WHERE id = $1",
      explain: (s) => s`EXPLAIN (FORMAT JSON) SELECT 1`,
      expectedPlan: {
        targetTable: "funds",
        expectedIndex: "funds_pkey",
        disallowSeqScan: true,
        allowedScanTypes: ["Index Only Scan"],
        maxCost: 100.0,
      },
    };

    const mockExplanation: PlanExplanation = {
      query,
      rootPlan: {
        "Node Type": "Index Scan",
        "Relation Name": "funds",
        "Index Name": "funds_pkey",
        "Total Cost": 5.0,
        "Startup Cost": 0.0,
        "Plan Rows": 1,
      },
      allNodes: [
        {
          "Node Type": "Index Scan",
          "Relation Name": "funds",
          "Index Name": "funds_pkey",
          "Total Cost": 5.0,
          "Startup Cost": 0.0,
          "Plan Rows": 1,
        },
      ],
    };

    const result = verifyPlanNode(mockExplanation, tableRowCounts);
    expect(result.passed).toBe(false);
    const violation = result.violations.find((v) => v.kind === "disallowed_scan_type");
    expect(violation).toBeDefined();
    expect(violation?.message).toContain("Index Scan");
    expect(violation?.message).toContain("Index Only Scan");
  });
});
