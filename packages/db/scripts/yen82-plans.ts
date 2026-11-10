import { readFile, writeFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import { createSql, migrate, publicAnchoredItemsSql, publicPledgedPaiseSql } from "@yen/db";
import * as z from "zod";
import { seedPublicFundPlanFixture } from "../src/test/public-fund-plan-fixture.js";

const sql = createSql(process.env.YEN_TEST_DATABASE_URL ?? "");
await migrate(sql);
const fund = "00000000-0000-4000-8000-000000000010";
if (process.argv.includes("--seed")) {
  await sql`INSERT INTO users (id, phone, display_name) VALUES ('00000000-0000-4000-8000-000000000001', '+919876543210', 'Bench')`;
  await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES ('00000000-0000-4000-8000-000000000002', 'Bench', 'society', '00000000-0000-4000-8000-000000000001')`;
  await sql`INSERT INTO funds (id,org_id,title,policy_json) VALUES (${fund},'00000000-0000-4000-8000-000000000002','Bench','{}')`;
  await seedPublicFundPlanFixture(sql, fund);
}
const before = await readFile("docs/evidence/yen-82/before-anchored.sql", "utf8");
const after = publicAnchoredItemsSql;
await writeFile("docs/evidence/yen-82/after-anchored.sql", after.trim() + ";\n");
const index = await readFile("packages/db/migrations/0034_public_pledge_totals.sql", "utf8");
const samples: { side: string; query: string; run: number; executionMs: number }[] = [];
const timings = z.array(z.object({ "QUERY PLAN": z.string() }));
for (let run = 1; run <= 5; run++) {
  for (const side of ["before", "after"]) {
    if (side === "before") await sql`DROP INDEX donation_pledges_outstanding_fund_idx`;
    else await sql.unsafe(index);
    for (const [name, query] of [
      ["anchored", side === "before" ? before : after],
      ["pledged", publicPledgedPaiseSql],
    ]) {
      if (!query) throw new Error("Missing SQL");
      const plan = timings.parse(await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${query}`, [fund]));
      const output = plan.map((row) => row["QUERY PLAN"]).join("\n") + "\n";
      await writeFile(`docs/evidence/yen-82/${side}-${name}-${run}.txt`, output);
      const execution = /Execution Time: ([\d.]+) ms/.exec(output)?.[1];
      if (!execution) throw new Error("No execution timing");
      samples.push({ side, query: name ?? "", run, executionMs: Number(execution) });
      const rows = await sql.unsafe(query, [fund]);
      if (name === "anchored" && rows.length !== 20000) throw new Error("Missing anchored work");
      if (name === "pledged" && rows[0]?.total !== "500000")
        throw new Error("Incorrect pledge sum");
    }
  }
}
await writeFile(
  "docs/evidence/yen-82/samples.json",
  JSON.stringify(
    {
      machine: { cores: cpus().length, loadAverage: loadavg() },
      fixture: {
        fundEvents: 50000,
        matchedCredits: 20000,
        pledges: 25000,
        confirmedAnchors: 5,
        resultItems: 20000,
        pledgedPaise: 500000,
      },
      samples,
    },
    null,
    2,
  ) + "\n",
);
await sql.end();
