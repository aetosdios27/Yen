import { migrate, uuidv7 } from "@yen/db";
import { beforeAll, expect, it } from "vitest";
import {
  explainQuery,
  getTableEstimatedRowCounts,
  verifyPlanNode,
} from "../../db/src/query-plan.js";
import type { SampleQueryContext } from "../../db/src/query-registry.js";
import { registerHotPathQuery } from "../../db/src/query-registry.js";
import { databaseSuite } from "../../db/src/test/database.js";
import { createPgBoss } from "./boss.js";
import { samplerQueries } from "./telemetry.js";

databaseSuite("sampler query-plan CI budgets", (sql, url) => {
  beforeAll(async () => {
    await migrate(sql);
    const user = uuidv7(),
      org = uuidv7();
    await sql`INSERT INTO users (id,phone,display_name) VALUES (${user}, '+919999888877', 'Fixture')`;
    await sql`INSERT INTO orgs (id,name,legal_form,owner_id) VALUES (${org}, 'Fixture','society',${user})`;
    await sql`ALTER TABLE fund_events DISABLE TRIGGER fund_events_before_insert`;
    const funds: [string, string, string, string] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    for (const fund of funds) {
      await sql`INSERT INTO funds (id,org_id,title,policy_json) VALUES (${fund},${org},'Fixture','{}')`;
      await sql`INSERT INTO fund_events SELECT ${fund}::uuid, n, 'fund.created', 1, ${`psn_${user}`}, '2026-01-01T00:00:00.000Z', '{}'::jsonb, repeat('0',64), repeat('0',64), '{}' FROM generate_series(1,50000) n`;
      await sql`INSERT INTO anchors (id,fund_id,from_seq,to_seq,root,status,chain_id,chain_sequence) SELECT gen_random_uuid(),${fund}::uuid,n,n,repeat('0',64),'confirmed',1, ${funds.indexOf(fund) * 50000} + n FROM generate_series(1,49999) n`;
    }
    await sql`INSERT INTO donation_pledges (id,fund_id,amount_paise,utr,status) SELECT gen_random_uuid(),${funds[0]}::uuid,100,lpad(n::text,12,'0'), CASE WHEN n % 1000 = 0 THEN 'pledged' ELSE 'verified' END FROM generate_series(1,200000) n`;
    const boss = createPgBoss({ connectionString: url, schema: "telemetry_plans", migrate: true });
    await boss.start();
    await boss.createQueue("fixture");
    try {
      await sql`INSERT INTO telemetry_plans.job (name, data, state) SELECT 'fixture', '{}'::jsonb, CASE WHEN n % 1000 = 0 THEN 'retry'::telemetry_plans.job_state ELSE 'completed'::telemetry_plans.job_state END FROM generate_series(1,200000) n`;
    } finally {
      await boss.stop();
    }
    await sql`ANALYZE`;
  }, 60000);
  it("bounds sampler plans at 200000 events, pledges and jobs", async () => {
    const counts = {
      ...(await getTableEstimatedRowCounts(sql)),
      ...(await getTableEstimatedRowCounts(sql, { schema: "pg_catalog" })),
    };
    const ctx = {} as SampleQueryContext;
    for (const [name, query] of Object.entries(samplerQueries)) {
      const entry = {
        id: `money_sampler_${name}`,
        name,
        category: "event_append" as const,
        sqlTemplate: name,
        explain: async () => sql`EXPLAIN (FORMAT JSON, VERBOSE) ${query(sql, "telemetry_plans")}`,
        expectedPlan: {
          targetTable:
            name === "anchors" ? "fund_events" : name === "pending" ? "donation_pledges" : "job",
          disallowSeqScan: true,
          ...(name === "anchors"
            ? { expectedIndex: "anchors_confirmed_head_idx" }
            : name === "pending"
              ? { expectedIndex: "donation_pledges_unverified_age_idx" }
              : {}),
          maxCost: name === "anchors" ? 10000 : 1000,
        },
      };
      registerHotPathQuery(entry);
      const result = verifyPlanNode(await explainQuery(sql, entry, ctx), counts);

      const plan = await sql`EXPLAIN (ANALYZE, BUFFERS) ${query(sql, "telemetry_plans")}`;
      console.info(name, plan.map((row) => row["QUERY PLAN"]).join("\n"));
      expect(result.violations, name).toEqual([]);
    }
  });
});
