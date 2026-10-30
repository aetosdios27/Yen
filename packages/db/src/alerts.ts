import * as z from "zod";
import type { Sql, SqlClient } from "./client.js";
import { uuidv7 } from "./uuidv7.js";

export const ALERT_TYPES = [
  "unapproved_debit",
  "balance_drift",
  "chain_verification_failure",
  "anchor_missing",
  "anchor_mismatch",
  "repeated_rejected_requests",
  "spend_rate_spike",
  "integrity_check_failure",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export const alertTypeSchema = z.enum(ALERT_TYPES);
export const alertSeveritySchema = z.enum(["info", "warning", "critical"]);

/**
 * System actor pseudonym recorded on alert_events rows that are produced by an
 * automated process (escalation) rather than a fund member. It mirrors the
 * `SYSTEM_ACTOR` pseudonym convention already used by the ledger and can never
 * collide with a real fund pseudonym.
 */
export const SYSTEM_ALERT_ACTOR = "psn_00000000-0000-7000-8000-000000000000";

export const DEFAULT_ALERT_ESCALATION_MINUTES = 60;
const ESCALATION_ENV = "ALERT_ESCALATION_MINUTES";

/** Single source of truth for the critical-alert escalation delay. */
export function alertEscalationMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[ESCALATION_ENV];
  if (raw === undefined || raw.trim() === "") return DEFAULT_ALERT_ESCALATION_MINUTES;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${ESCALATION_ENV} must be a positive integer`);
  }
  return value;
}

export function escalationDueAt(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60 * 1000);
}

export const alertRowSchema = z.object({
  id: z.uuid(),
  fund_id: z.uuid().nullable(),
  alert_type: alertTypeSchema,
  severity: alertSeveritySchema,
  title: z.string(),
  details: z.string(),
  entity_type: z.string().nullable(),
  entity_id: z.string().nullable(),
  dedup_key: z.string().nullable(),
  status: z.enum(["open", "acknowledged", "resolved"]),
  acknowledged_by: z.string().nullable(),
  acknowledged_at: z.date().nullable(),
  acknowledgement_note: z.string().nullable(),
  resolved_by: z.string().nullable(),
  resolved_at: z.date().nullable(),
  resolution_note: z.string().nullable(),
  escalated_at: z.date().nullable(),
  escalation_due_at: z.date().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type AlertRow = z.infer<typeof alertRowSchema>;

export interface RaiseAlertInput {
  readonly fundId: string | null;
  readonly alertType: AlertType;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly details: string;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  /** Defaults to entityId. Part of the open/acknowledged dedup index. */
  readonly dedupKey?: string | null;
  readonly escalationDueAt?: Date | null;
  readonly now?: Date;
}

/**
 * Inserts an alert with ON CONFLICT dedup. A repeat trigger for the same
 * open/acknowledged alert inserts nothing and returns null. Critical alerts are
 * stamped with `escalation_due_at` (unless the caller pinned one) so the
 * escalation job can pick them up later.
 */
export async function raiseAlert(sql: SqlClient, input: RaiseAlertInput): Promise<AlertRow | null> {
  const now = input.now ?? new Date();
  const entityId = input.entityId ?? null;
  const dedupKey = input.dedupKey ?? entityId;
  const dueAt =
    input.escalationDueAt !== undefined
      ? input.escalationDueAt
      : input.severity === "critical"
        ? escalationDueAt(now, alertEscalationMinutes())
        : null;
  const rows = await sql`
    INSERT INTO alerts (
      id, fund_id, alert_type, severity, title, details,
      entity_type, entity_id, dedup_key, escalation_due_at
    ) VALUES (
      ${uuidv7()}, ${input.fundId}, ${input.alertType}, ${input.severity}, ${input.title},
      ${input.details}, ${input.entityType ?? null}, ${entityId}, ${dedupKey}, ${dueAt}
    )
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  const row = rows[0];
  return row ? alertRowSchema.parse(row) : null;
}

/**
 * Raises an alert and, when it is newly created (not deduped), enqueues
 * consent-checked owner/approver notifications for warning/critical fund alerts.
 * Returns the created alert, or null when a repeat trigger was deduplicated.
 */
export async function raiseAlertWithNotification(
  sql: SqlClient,
  input: RaiseAlertInput & { readonly suffix?: string },
): Promise<AlertRow | null> {
  const row = await raiseAlert(sql, input);
  if (row && row.fund_id && input.severity !== "info") {
    await enqueueAlertNotifications(sql, {
      fundId: row.fund_id,
      alertId: row.id,
      alertType: input.alertType,
      severity: input.severity,
      title: input.title,
      suffix: input.suffix ?? "raised",
    });
  }
  return row;
}

/** Fund owner + approver (active memberships) user ids, distinct. */
export async function alertRecipientUserIds(
  sql: SqlClient,
  fundId: string,
  roles: readonly ("owner" | "approver")[],
): Promise<string[]> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT user_id
    FROM memberships
    WHERE fund_id = ${fundId} AND role IN ${sql(roles)} AND status = 'active'
  `;
  return rows.map((row) => row.user_id);
}

export interface EnqueueAlertNotificationsInput {
  readonly fundId: string;
  readonly alertId: string;
  readonly alertType: AlertType;
  readonly severity: AlertSeverity;
  readonly title: string;
  /** Distinguishes raise vs escalation notifications in the idempotency key. */
  readonly suffix: string;
  readonly recipientRoles?: readonly ("owner" | "approver")[];
  readonly now?: Date;
}

/**
 * Enqueues a consent-checked WhatsApp/SMS notification for an alert to the fund
 * owner and approvers through the existing `notification_outbox` table. Delivery
 * is performed later by the notifications worker, which honors channel consent.
 * Each insert is idempotent on its idempotency_key.
 */
export async function enqueueAlertNotifications(
  sql: SqlClient,
  input: EnqueueAlertNotificationsInput,
): Promise<number> {
  const roles = input.recipientRoles ?? (["owner", "approver"] as const);
  const recipients = await alertRecipientUserIds(sql, input.fundId, roles);
  if (recipients.length === 0) return 0;
  const titleRows = await sql<{ title: string }[]>`
    SELECT title FROM funds WHERE id = ${input.fundId}
  `;
  const fundTitle = titleRows[0]?.title ?? "";
  const now = input.now ?? new Date();
  const templateData = {
    fund_title: fundTitle,
    alert_type: input.alertType,
    severity: input.severity,
    title: input.title,
  };
  let enqueued = 0;
  for (const userId of recipients) {
    const inserted = await sql`
      INSERT INTO notification_outbox (
        id, fund_id, user_id, event_id, idempotency_key, template_id,
        template_data, preferred_channel, status, attempts, max_attempts,
        next_attempt_at, cost_paise, created_at, updated_at
      ) VALUES (
        ${uuidv7()}, ${input.fundId}, ${userId}, ${input.alertId},
        ${`alert:${input.fundId}:${userId}:${input.alertId}:${input.suffix}`},
        'fund_alert', ${sql.json(templateData)}, 'whatsapp', 'pending', 0, 3,
        ${now}, 0, ${now}, ${now}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) enqueued++;
  }
  return enqueued;
}

export interface AcknowledgeAlertInput {
  readonly alertId: string;
  readonly actorPseudonym: string;
  readonly note: string;
  readonly now?: Date;
}

export interface ResolveAlertInput {
  readonly alertId: string;
  readonly actorPseudonym: string;
  readonly note: string;
  readonly now?: Date;
}

/**
 * Acknowledges an open alert and records an append-only alert_events row in one
 * transaction. The note is required by the database CHECK/trigger constraints.
 */
export async function acknowledgeAlert(
  sql: Sql,
  input: AcknowledgeAlertInput,
): Promise<AlertRow | null> {
  return sql.begin(async (tx) => {
    const now = input.now ?? new Date();
    const updated = await tx`
      UPDATE alerts
      SET status = 'acknowledged', acknowledged_by = ${input.actorPseudonym},
          acknowledged_at = ${now}, acknowledgement_note = ${input.note}, updated_at = ${now}
      WHERE id = ${input.alertId} AND status = 'open'
      RETURNING *
    `;
    const row = updated[0];
    if (!row) return null;
    await tx`
      INSERT INTO alert_events (id, alert_id, fund_id, event_type, actor_pseudonym, note, created_at)
      VALUES (${uuidv7()}, ${input.alertId}, ${row.fund_id}, 'acknowledged', ${input.actorPseudonym}, ${input.note}, ${now})
    `;
    return alertRowSchema.parse(row);
  });
}

/**
 * Resolves an open or acknowledged alert and records an append-only alert_events
 * row in one transaction. Resolved alerts cannot be reopened (DB trigger).
 */
export async function resolveAlert(sql: Sql, input: ResolveAlertInput): Promise<AlertRow | null> {
  return sql.begin(async (tx) => {
    const now = input.now ?? new Date();
    const updated = await tx`
      UPDATE alerts
      SET status = 'resolved', resolved_by = ${input.actorPseudonym},
          resolved_at = ${now}, resolution_note = ${input.note}, updated_at = ${now}
      WHERE id = ${input.alertId} AND status IN ('open', 'acknowledged')
      RETURNING *
    `;
    const row = updated[0];
    if (!row) return null;
    await tx`
      INSERT INTO alert_events (id, alert_id, fund_id, event_type, actor_pseudonym, note, created_at)
      VALUES (${uuidv7()}, ${input.alertId}, ${row.fund_id}, 'resolved', ${input.actorPseudonym}, ${input.note}, ${now})
    `;
    return alertRowSchema.parse(row);
  });
}

export interface ListAlertsInput {
  readonly fundId: string;
  readonly limit: number;
  /** Exclusive lower bound for keyset pagination on created_at. */
  readonly before?: string | null;
}

/** Paginated alerts for a fund, newest first. */
export async function listAlerts(sql: SqlClient, input: ListAlertsInput): Promise<AlertRow[]> {
  const rows = input.before
    ? await sql`
        SELECT * FROM alerts
        WHERE fund_id = ${input.fundId} AND created_at < ${input.before}::timestamptz
        ORDER BY created_at DESC
        LIMIT ${input.limit}
      `
    : await sql`
        SELECT * FROM alerts
        WHERE fund_id = ${input.fundId}
        ORDER BY created_at DESC
        LIMIT ${input.limit}
      `;
  return z.array(alertRowSchema).parse(rows);
}

export async function getAlert(sql: SqlClient, alertId: string): Promise<AlertRow | null> {
  const rows = await sql`SELECT * FROM alerts WHERE id = ${alertId}`;
  const row = rows[0];
  return row ? alertRowSchema.parse(row) : null;
}

// --- Detection rules -----------------------------------------------------

export const REPEATED_REJECTION_THRESHOLD = 3;
export const REPEATED_REJECTION_WINDOW_DAYS = 7;

export const SPEND_SPIKE_FACTOR = 3;
export const SPEND_SPIKE_WINDOW_HOURS = 24;
export const SPEND_SPIKE_BASELINE_DAYS = 30;
/** Absolute floor (paise) below which a spike is never raised, even if relative. */
export const SPEND_SPIKE_MIN_ABS_PAISE = 100_000n; // ₹1,000

/**
 * Raises `repeated_rejected_requests` when a fund has accumulated at least
 * `REPEATED_REJECTION_THRESHOLD` expense rejections in the rolling
 * `REPEATED_REJECTION_WINDOW_DAYS`-day window.
 */
export async function raiseRepeatedRejectionsIfThreshold(
  sql: SqlClient,
  fundId: string,
  now: Date = new Date(),
): Promise<AlertRow | null> {
  const windowStart = new Date(
    now.getTime() - REPEATED_REJECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM expenses
    WHERE fund_id = ${fundId}
      AND status = 'rejected'
      AND (expense_data->>'rejectedAt')::timestamptz >= ${windowStart.toISOString()}::timestamptz
  `;
  const count = rows[0]?.count ?? 0;
  if (count < REPEATED_REJECTION_THRESHOLD) return null;
  return raiseAlertWithNotification(sql, {
    fundId,
    alertType: "repeated_rejected_requests",
    severity: "warning",
    title: "Repeated rejected requests",
    details: `${count} expense requests rejected in the last ${REPEATED_REJECTION_WINDOW_DAYS} days`,
    entityType: "fund",
    entityId: fundId,
    dedupKey: fundId,
    now,
  });
}

/**
 * The spend-rate-spike rule, in one place: raise when the paid total over the
 * last `SPEND_SPIKE_WINDOW_HOURS` hours exceeds `SPEND_SPIKE_FACTOR` times the
 * fund's average daily paid total over the prior `SPEND_SPIKE_BASELINE_DAYS`
 * days (and clears the small absolute floor `SPEND_SPIKE_MIN_ABS_PAISE`).
 */
export async function raiseSpendRateSpikeIfSpiking(
  sql: SqlClient,
  fundId: string,
  now: Date = new Date(),
): Promise<AlertRow | null> {
  const windowStart = new Date(now.getTime() - SPEND_SPIKE_WINDOW_HOURS * 60 * 60 * 1000);
  const baselineStart = new Date(now.getTime() - SPEND_SPIKE_BASELINE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await sql<{ recent: bigint; baseline: bigint }[]>`
    WITH recent AS (
      SELECT COALESCE(SUM((expense_data->>'amountPaise')::bigint), 0)::bigint AS total
      FROM expenses
      WHERE fund_id = ${fundId}
        AND status IN ('paid', 'reconciled')
        AND (expense_data->>'paidAt')::timestamptz >= ${windowStart.toISOString()}::timestamptz
    ), baseline AS (
      SELECT COALESCE(SUM((expense_data->>'amountPaise')::bigint), 0)::bigint AS total
      FROM expenses
      WHERE fund_id = ${fundId}
        AND status IN ('paid', 'reconciled')
        AND (expense_data->>'paidAt')::timestamptz >= ${baselineStart.toISOString()}::timestamptz
        AND (expense_data->>'paidAt')::timestamptz < ${windowStart.toISOString()}::timestamptz
    )
    SELECT recent.total AS recent, baseline.total AS baseline FROM recent, baseline
  `;
  const totals = rows[0];
  if (!totals) return null;
  const recentPaise = BigInt(totals.recent);
  const baselineDailyPaise = BigInt(totals.baseline) / BigInt(SPEND_SPIKE_BASELINE_DAYS);
  const spiking =
    recentPaise >= SPEND_SPIKE_MIN_ABS_PAISE &&
    recentPaise > BigInt(SPEND_SPIKE_FACTOR) * baselineDailyPaise;
  if (!spiking) return null;
  return raiseAlertWithNotification(sql, {
    fundId,
    alertType: "spend_rate_spike",
    severity: "warning",
    title: "Spend rate spike",
    details: `Paid ${recentPaise} paise in the last ${SPEND_SPIKE_WINDOW_HOURS}h versus a ${SPEND_SPIKE_BASELINE_DAYS}-day daily average of ${baselineDailyPaise}`,
    entityType: "fund",
    entityId: fundId,
    dedupKey: fundId,
    now,
  });
}
