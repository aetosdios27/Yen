import type { Sql } from "@yen/db";

export async function escalateDueAlerts(sql: Sql, now: Date = new Date()): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE alerts
       SET escalated_at = ${now.toISOString()},
           updated_at = ${now.toISOString()}
     WHERE status = 'open'
       AND severity = 'critical'
       AND escalation_due_at IS NOT NULL
       AND escalation_due_at <= ${now.toISOString()}::timestamptz
       AND escalated_at IS NULL
    RETURNING id
  `;
  return rows.length;
}
