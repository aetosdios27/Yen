import type { Sql } from "./client.js";

export interface RetentionPeriods {
  readonly otpHours: number;
  readonly otpAttemptDays: number;
  readonly sessionDays: number;
  readonly inviteDays: number;
  readonly logDays: number;
  readonly auditDays: number;
  readonly waitlistDays: number;
}

export const DEFAULT_RETENTION_PERIODS: RetentionPeriods = {
  otpHours: 24,
  otpAttemptDays: 30,
  sessionDays: 30,
  inviteDays: 30,
  logDays: 30,
  auditDays: 2555,
  waitlistDays: 365,
};

export interface RetentionReport {
  readonly dryRun: boolean;
  readonly wouldPurge: Readonly<Record<string, number>>;
  readonly retentionRequiredUsers: number;
}

/** Purges expired operational data only; immutable fund_events and Merkle anchors are untouched. */
export async function runRetentionJob(
  sql: Sql,
  options: { readonly dryRun?: boolean; readonly periods?: Partial<RetentionPeriods> } = {},
): Promise<RetentionReport> {
  const periods = { ...DEFAULT_RETENTION_PERIODS, ...options.periods };
  for (const [name, value] of Object.entries(periods)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`Invalid retention period: ${name}`);
  }
  const dryRun = options.dryRun ?? false;
  return await sql.begin(async (tx) => {
    const count = async (table: string, predicate: string, period: number) => {
      const rows = await tx.unsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM ${table} WHERE ${predicate}`,
        [period],
      );
      return rows[0]?.count ?? 0;
    };
    const specs = {
      auth_otps: ["created_at < now() - ($1::int * interval '1 hour')", periods.otpHours],
      auth_otp_attempt_limits: [
        "updated_at < now() - ($1::int * interval '1 day')",
        periods.otpAttemptDays,
      ],
      sessions: [
        "expires_at < now() - ($1::int * interval '1 day') OR revoked_at < now() - ($1::int * interval '1 day')",
        periods.sessionDays,
      ],
      owner_invites: ["expires_at < now() - ($1::int * interval '1 day')", periods.inviteDays],
      idempotency_keys: ["created_at < now() - ($1::int * interval '1 day')", periods.logDays],
      rate_limits: ["expires_at < now() - ($1::int * interval '1 day')", 0],
      notification_outbox: [
        "status IN ('delivered', 'failed', 'dead_letter', 'skipped') AND updated_at < now() - ($1::int * interval '1 day')",
        periods.logDays,
      ],
      consent_records: [
        "withdrawn_at IS NOT NULL AND withdrawn_at < now() - ($1::int * interval '1 day')",
        periods.auditDays,
      ],
      erasure_requests: [
        "completed_at IS NOT NULL AND completed_at < now() - ($1::int * interval '1 day')",
        periods.auditDays,
      ],
      retention_audit: ["created_at < now() - ($1::int * interval '1 day')", periods.auditDays],
      waitlist_entries: ["created_at < now() - ($1::int * interval '1 day')", periods.waitlistDays],
    } as const;
    const wouldPurge: Record<string, number> = {};
    for (const [table, [predicate, period]] of Object.entries(specs)) {
      wouldPurge[table] = await count(table, predicate, period);
    }
    const deadLetterRows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notification_dead_letter d
      JOIN notification_outbox o ON o.id = d.notification_id
      WHERE o.status IN ('delivered', 'failed', 'dead_letter', 'skipped')
        AND o.updated_at < now() - (${periods.logDays} * interval '1 day')
    `;
    wouldPurge.notification_dead_letter = deadLetterRows[0]?.count ?? 0;
    const stagedIntentsTable = await tx<{ exists: boolean }[]>`
      SELECT to_regclass('public.konto_staged_intents') IS NOT NULL AS exists
    `;
    if (stagedIntentsTable[0]?.exists) {
      wouldPurge.konto_staged_intents = await count(
        "konto_staged_intents",
        "expires_at < now() - ($1::int * interval '1 day')",
        periods.logDays,
      );
    } else {
      wouldPurge.konto_staged_intents = 0;
    }
    const retained = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM users WHERE retention_required
    `;
    const expiredDevices = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM trusted_devices d JOIN sessions s ON s.id = d.session_id
      WHERE d.idle_expires_at < now() - (${periods.sessionDays} * interval '1 day')
         OR s.expires_at < now() - (${periods.sessionDays} * interval '1 day')
         OR s.revoked_at < now() - (${periods.sessionDays} * interval '1 day')
    `;
    wouldPurge.trusted_devices = expiredDevices[0]?.count ?? 0;
    if (!dryRun) {
      await tx`DELETE FROM trusted_devices d USING sessions s WHERE d.session_id = s.id
        AND (d.idle_expires_at < now() - (${periods.sessionDays} * interval '1 day')
          OR s.expires_at < now() - (${periods.sessionDays} * interval '1 day')
          OR s.revoked_at < now() - (${periods.sessionDays} * interval '1 day'))`;
      await tx`DELETE FROM notification_dead_letter d USING notification_outbox o
        WHERE d.notification_id = o.id AND o.status IN ('delivered', 'failed', 'dead_letter', 'skipped')
          AND o.updated_at < now() - (${periods.logDays} * interval '1 day')`;
      if (stagedIntentsTable[0]?.exists) {
        await tx`DELETE FROM konto_staged_intents
          WHERE expires_at < now() - (${periods.logDays} * interval '1 day')`;
      }
      for (const [table, [predicate, period]] of Object.entries(specs)) {
        await tx.unsafe(`DELETE FROM ${table} WHERE ${predicate}`, [period]);
      }
    }
    return { dryRun, wouldPurge, retentionRequiredUsers: retained[0]?.count ?? 0 };
  });
}
