import type { Sql } from "@yen/db";
import { observeObjective, recordSaturation } from "@yen/shared/telemetry";

/** Samples outstanding work, so a stopped or failing consumer cannot hide behind zero completions. */
export async function sampleMoneyTelemetry(sql: Sql, schema: string): Promise<void> {
  const anchors = await sql<{ lag_ms: number }[]>`
    SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(e.occurred_at::timestamptz))) * 1000 AS lag_ms
    FROM fund_events e
    WHERE e.seq > COALESCE((SELECT MAX(a.to_seq) FROM anchors a WHERE a.fund_id = e.fund_id AND a.status = 'confirmed'), 0)
    GROUP BY e.fund_id`;
  observeObjective(
    "anchor_lag",
    anchors.every((row) => Number(row.lag_ms) <= 3600000),
  );
  const pending = await sql<{ lag_ms: number }[]>`
    SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at))) * 1000 AS lag_ms
    FROM donation_pledges WHERE status = 'pledged' HAVING COUNT(*) > 0`;
  observeObjective(
    "reconciliation_lag",
    pending.every((row) => Number(row.lag_ms) <= 900000),
  );
  const depth = await sql<
    { depth: string }[]
  >`SELECT COUNT(*) AS depth FROM ${sql(schema)}.job WHERE state IN ('created', 'retry', 'active')`;
  recordSaturation("queue.depth", Number(depth[0]?.depth ?? 0));
  const connections = await sql<
    { count: string }[]
  >`SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'`;
  recordSaturation("pool.connections", Number(connections[0]?.count ?? 0));
}
