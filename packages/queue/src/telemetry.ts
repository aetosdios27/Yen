import type { Sql } from "@yen/db";
import { observeObjective, recordSamplerFailure, recordSaturation } from "@yen/shared/telemetry";
import { logQueueError } from "./boss.js";

/** Samples outstanding work, so a stopped or failing consumer cannot hide behind zero completions. */
export async function sampleMoneyTelemetry(sql: Sql, schema: string): Promise<void> {
  await Promise.all([
    measurement("anchor_lag", async () => {
      const anchors = await samplerQueries.anchors(sql, schema);
      observeObjective(
        "anchor_lag",
        anchors.every((row) => Number(row.lag_ms) <= 3600000),
      );
    }),
    measurement("reconciliation_lag", async () => {
      const pending = await samplerQueries.pending(sql, schema);
      observeObjective(
        "reconciliation_lag",
        pending.every((row) => Number(row.lag_ms) <= 900000),
      );
    }),
    measurement("queue_depth", async () => {
      const depth = await samplerQueries.depth(sql, schema);
      recordSaturation("queue.depth", Number(depth[0]?.depth ?? 0));
    }),
    measurement("database_connections", async () => {
      const connections = await samplerQueries.connections(sql, schema);
      recordSaturation("database.client_connections", Number(connections[0]?.count ?? 0));
    }),
  ]);
}

async function measurement(id: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    recordSamplerFailure(id);
    logQueueError("money telemetry measurement failed", error);
  }
}

export const samplerQueries = {
  anchors: (sql: Sql, _schema: string) => sql`
    SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - e.occurred_at::timestamptz)) * 1000 AS lag_ms
    FROM funds f
    CROSS JOIN LATERAL (
      SELECT occurred_at FROM fund_events
      WHERE fund_id = f.id AND seq > COALESCE((
        SELECT to_seq FROM anchors WHERE fund_id = f.id AND status = 'confirmed'
        ORDER BY to_seq DESC LIMIT 1
      ), 0)
      ORDER BY seq LIMIT 1
    ) e`,
  pending: (sql: Sql, _schema: string) => sql`
    SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at))) * 1000 AS lag_ms
    FROM (SELECT created_at FROM donation_pledges WHERE status = 'pledged' ORDER BY created_at LIMIT 1) pending HAVING COUNT(*) > 0`,
  depth: (sql: Sql, schema: string) =>
    sql`SELECT COUNT(*) AS depth FROM ${sql(schema)}.job WHERE state IN ('created', 'retry', 'active')`,
  connections: (sql: Sql, _schema: string) =>
    sql`SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'`,
};
