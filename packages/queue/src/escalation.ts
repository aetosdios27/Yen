import {
  type AlertSeverity,
  type AlertType,
  enqueueAlertNotifications,
  type Sql,
  SYSTEM_ALERT_ACTOR,
  uuidv7,
} from "@yen/db";

interface DueAlertRow {
  id: string;
  fund_id: string | null;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
}

/**
 * Escalates every due critical alert exactly once: sets `escalated_at`, records
 * an append-only `escalated` alert_events row, and enqueues a consent-checked
 * notification to the fund owner through the existing notifications outbox.
 * The `escalated_at IS NULL` guard (under FOR UPDATE SKIP LOCKED) makes a second
 * run a no-op.
 */
export async function escalateDueAlerts(sql: Sql, now: Date = new Date()): Promise<number> {
  return sql.begin(async (tx) => {
    const due = await tx<DueAlertRow[]>`
      SELECT id, fund_id, alert_type, severity, title
      FROM alerts
      WHERE status = 'open'
        AND severity = 'critical'
        AND escalation_due_at IS NOT NULL
        AND escalation_due_at <= ${now.toISOString()}::timestamptz
        AND escalated_at IS NULL
      FOR UPDATE SKIP LOCKED
    `;

    let escalated = 0;
    for (const alert of due) {
      const updated = await tx`
        UPDATE alerts
        SET escalated_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
        WHERE id = ${alert.id} AND escalated_at IS NULL
        RETURNING id
      `;
      if (updated.length === 0) continue;

      await tx`
        INSERT INTO alert_events (id, alert_id, fund_id, event_type, actor_pseudonym, note, created_at)
        VALUES (${uuidv7()}, ${alert.id}, ${alert.fund_id}, 'escalated', ${SYSTEM_ALERT_ACTOR}, 'Escalated automatically', ${now})
      `;
      if (alert.fund_id) {
        await enqueueAlertNotifications(tx, {
          fundId: alert.fund_id,
          alertId: alert.id,
          alertType: alert.alert_type,
          severity: alert.severity,
          title: alert.title,
          suffix: "escalation",
          variant: "escalation",
          recipientRoles: ["owner"],
          now,
        });
      }
      escalated++;
    }
    return escalated;
  });
}
