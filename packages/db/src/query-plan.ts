import * as z from "zod";
import type { Sql } from "./client.js";
import {
  getRegisteredHotPathQueries,
  type RegisteredHotPathQuery,
  type SampleQueryContext,
} from "./query-registry.js";

/**
 * PostgreSQL Query Plan Verification and Budgeting.
 *
 * Primary PostgreSQL 16 Documentation:
 * - 14.1. Using EXPLAIN:
 *   https://www.postgresql.org/docs/16/using-explain.html
 *   "Choosing the right plan to match the query structure and the properties of the data
 *   is absolutely critical for good performance... The very first line (the summary line
 *   for the topmost node) has the estimated total execution cost for the plan; it is this
 *   number that the planner seeks to minimize."
 * - 14.1.3. Caveats on Planner Cost Estimates:
 *   https://www.postgresql.org/docs/16/using-explain.html#USING-EXPLAIN-CAVEATS
 *   "EXPLAIN results should not be extrapolated to situations much different from the one
 *   you are actually testing; for example, results on a toy-sized table cannot be assumed
 *   to apply to large tables... on a table that only occupies one disk page, you'll nearly
 *   always get a sequential scan plan whether indexes are available or not."
 * - Query Planning Cost Constants:
 *   https://www.postgresql.org/docs/16/runtime-config-query.html#RUNTIME-CONFIG-QUERY-CONSTANTS
 *   Costs are measured in units of single sequential page fetch (seq_page_cost = 1.0,
 *   random_page_cost = 4.0 by default).
 */

export type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string | undefined;
  "Index Name"?: string | undefined;
  "Total Cost": number;
  "Startup Cost": number;
  "Plan Rows": number;
  Plans?: PlanNode[] | undefined;
  [key: string]: unknown;
};

export type PlanViolation = {
  queryId: string;
  kind: "cost_budget" | "seq_scan_forbidden" | "seq_scan_large_table" | "missing_expected_index";
  message: string;
  actualCost?: number | undefined;
  maxCostBudget?: number | undefined;
  actualIndex?: string | undefined;
  expectedIndex?: string | string[] | undefined;
};

export type PlanExplanation = {
  query: RegisteredHotPathQuery;
  rootPlan: PlanNode;
  allNodes: PlanNode[];
};

export type PlanVerificationResult = {
  queryId: string;
  passed: boolean;
  actualCost: number;
  maxCostBudget: number;
  indexUsed?: string | undefined;
  violations: PlanViolation[];
};

const explainResultSchema = z.array(
  z.object({
    "QUERY PLAN": z.array(
      z.object({
        Plan: z
          .object({
            "Node Type": z.string(),
            "Total Cost": z.number(),
            "Startup Cost": z.number(),
            "Plan Rows": z.number(),
            "Relation Name": z.string().optional(),
            "Index Name": z.string().optional(),
          })
          .passthrough(),
      }),
    ),
  }),
);

/**
 * Flatten all plan nodes from root node recursively.
 */
export function collectPlanNodes(node: PlanNode): PlanNode[] {
  const nodes: PlanNode[] = [node];
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) {
      nodes.push(...collectPlanNodes(child));
    }
  }
  return nodes;
}

/**
 * Runs EXPLAIN (FORMAT JSON) on a registered query and extracts the parsed plan.
 */
export async function explainQuery(
  sql: Sql,
  query: RegisteredHotPathQuery,
  ctx: SampleQueryContext,
): Promise<PlanExplanation> {
  const raw = await query.explain(sql, ctx);
  const parsed = explainResultSchema.parse(raw);
  const rootPlan = parsed[0]?.["QUERY PLAN"][0]?.Plan as PlanNode;
  if (!rootPlan) {
    throw new Error(`Failed to extract plan for query "${query.id}"`);
  }
  const allNodes = collectPlanNodes(rootPlan);
  return { query, rootPlan, allNodes };
}

/**
 * Verifies a query's plan against its expected plan shape and table size thresholds.
 */
export function verifyPlanNode(
  planExplanation: PlanExplanation,
  tableRowCounts: Record<string, number> = {},
): PlanVerificationResult {
  const { query, rootPlan, allNodes } = planExplanation;
  const violations: PlanViolation[] = [];
  const actualCost = rootPlan["Total Cost"];

  // 1. Cost budget check
  if (actualCost > query.expectedPlan.maxCost) {
    violations.push({
      queryId: query.id,
      kind: "cost_budget",
      actualCost,
      maxCostBudget: query.expectedPlan.maxCost,
      message: `Query "${query.id}" estimated cost ${actualCost} exceeds budget ${query.expectedPlan.maxCost}`,
    });
  }

  // 2. Sequential scan checks
  for (const node of allNodes) {
    if (node["Node Type"] === "Seq Scan") {
      const relation = node["Relation Name"] ?? "unknown";
      const rows = tableRowCounts[relation] ?? 0;

      // Disallow on target table if query forbids seq scan
      if (relation === query.expectedPlan.targetTable && query.expectedPlan.disallowSeqScan) {
        const expected = Array.isArray(query.expectedPlan.expectedIndex)
          ? query.expectedPlan.expectedIndex.join(" or ")
          : (query.expectedPlan.expectedIndex ?? "none");
        violations.push({
          queryId: query.id,
          kind: "seq_scan_forbidden",
          message: `Query "${query.id}" performed a Sequential Scan on target table "${relation}". Expected index: "${expected}".`,
        });
      }

      // Hard check: No registered hot-path query does a sequential scan on a table over 100k rows
      if (rows > 100000) {
        violations.push({
          queryId: query.id,
          kind: "seq_scan_large_table",
          message: `Query "${query.id}" performed a Sequential Scan on table "${relation}" with ${rows} rows (> 100,000 row threshold).`,
        });
      }
    }
  }

  // 3. Expected index check
  let indexUsed: string | undefined;
  if (query.expectedPlan.expectedIndex) {
    const expected = Array.isArray(query.expectedPlan.expectedIndex)
      ? query.expectedPlan.expectedIndex
      : [query.expectedPlan.expectedIndex];

    const matchingIndexNode = allNodes.find(
      (node) =>
        node["Index Name"] &&
        expected.some((exp) => node["Index Name"] === exp || node["Index Name"]?.includes(exp)),
    );

    if (matchingIndexNode) {
      indexUsed = matchingIndexNode["Index Name"];
    } else {
      const foundIndexes = allNodes.map((n) => n["Index Name"]).filter(Boolean);
      violations.push({
        queryId: query.id,
        kind: "missing_expected_index",
        expectedIndex: query.expectedPlan.expectedIndex,
        actualIndex: foundIndexes.join(", "),
        message: `Query "${query.id}" expected index "${expected.join(
          " or ",
        )}" but plan used: [${foundIndexes.join(", ")}]`,
      });
    }
  } else {
    indexUsed = allNodes.find((n) => n["Index Name"])?.["Index Name"];
  }

  return {
    queryId: query.id,
    passed: violations.length === 0,
    actualCost,
    maxCostBudget: query.expectedPlan.maxCost,
    indexUsed,
    violations,
  };
}

/**
 * Verifies all registered queries against the database and returns results.
 * Throws if any query violates its plan shape.
 */
export async function assertAllRegisteredQueryPlans(
  sql: Sql,
  ctx: SampleQueryContext,
  tableRowCounts: Record<string, number> = {},
): Promise<PlanVerificationResult[]> {
  const queries = getRegisteredHotPathQueries();
  const results: PlanVerificationResult[] = [];
  const allViolations: PlanViolation[] = [];

  for (const query of queries) {
    const explanation = await explainQuery(sql, query, ctx);
    const result = verifyPlanNode(explanation, tableRowCounts);
    results.push(result);
    if (!result.passed) {
      allViolations.push(...result.violations);
    }
  }

  if (allViolations.length > 0) {
    const details = allViolations.map((v) => `  - [${v.queryId}] ${v.message}`).join("\n");
    throw new Error(
      `Query plan discipline verification failed with ${allViolations.length} violation(s):\n${details}`,
    );
  }

  return results;
}
