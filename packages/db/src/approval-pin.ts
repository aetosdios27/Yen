import type { Sql, SqlClient, TransactionSql } from "./client.js";
import { type UserApprovalPinRow, userApprovalPinRowSchema } from "./rows.js";

export interface CreateApprovalPinInput {
  readonly userId: string;
  readonly salt: string;
  readonly pinHash: string;
  readonly failedAttempts?: number | undefined;
  readonly totalFailed24h?: number | undefined;
  readonly firstFailedAt?: Date | null | undefined;
  readonly lockedUntil?: Date | null | undefined;
  readonly coolingOffUntil?: Date | null | undefined;
  readonly status?: "active" | "locked_out" | "cooling_off" | undefined;
}

export interface UpdateApprovalPinInput {
  readonly salt?: string | undefined;
  readonly pinHash?: string | undefined;
  readonly failedAttempts?: number | undefined;
  readonly totalFailed24h?: number | undefined;
  readonly firstFailedAt?: Date | null | undefined;
  readonly lockedUntil?: Date | null | undefined;
  readonly coolingOffUntil?: Date | null | undefined;
  readonly status?: "active" | "locked_out" | "cooling_off" | undefined;
}

export async function getApprovalPin(
  sql: SqlClient,
  userId: string,
): Promise<UserApprovalPinRow | null> {
  const rows = await sql`
    SELECT * FROM user_approval_pins WHERE user_id = ${userId}
  `;
  if (rows.length === 0) return null;
  return userApprovalPinRowSchema.parse(rows[0]);
}

export async function withLockedApprovalPin<T>(
  sql: Sql,
  userId: string,
  work: (tx: TransactionSql, row: UserApprovalPinRow | null) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT * FROM user_approval_pins WHERE user_id = ${userId} FOR UPDATE
    `;
    const row = rows.length === 0 ? null : userApprovalPinRowSchema.parse(rows[0]);
    return { value: await work(tx, row) };
  });
  return result.value;
}

export async function createApprovalPin(
  sql: SqlClient,
  input: CreateApprovalPinInput,
): Promise<UserApprovalPinRow> {
  const rows = await sql`
    INSERT INTO user_approval_pins (
      user_id, salt, pin_hash, failed_attempts, total_failed_24h,
      first_failed_at, locked_until, cooling_off_until, status
    ) VALUES (
      ${input.userId},
      ${input.salt},
      ${input.pinHash},
      ${input.failedAttempts ?? 0},
      ${input.totalFailed24h ?? 0},
      ${input.firstFailedAt ?? null},
      ${input.lockedUntil ?? null},
      ${input.coolingOffUntil ?? null},
      ${input.status ?? "active"}
    ) RETURNING *
  `;
  return userApprovalPinRowSchema.parse(rows[0]);
}

export async function updateApprovalPin(
  sql: SqlClient,
  userId: string,
  updates: UpdateApprovalPinInput,
): Promise<UserApprovalPinRow | null> {
  const rows = await sql`
    UPDATE user_approval_pins SET
      salt = COALESCE(${updates.salt ?? null}::text, salt),
      pin_hash = COALESCE(${updates.pinHash ?? null}::text, pin_hash),
      failed_attempts = COALESCE(${updates.failedAttempts ?? null}::integer, failed_attempts),
      total_failed_24h = COALESCE(${updates.totalFailed24h ?? null}::integer, total_failed_24h),
      first_failed_at = CASE WHEN ${updates.firstFailedAt !== undefined}::boolean
        THEN ${updates.firstFailedAt ?? null}::timestamptz ELSE first_failed_at END,
      locked_until = CASE WHEN ${updates.lockedUntil !== undefined}::boolean
        THEN ${updates.lockedUntil ?? null}::timestamptz ELSE locked_until END,
      cooling_off_until = CASE WHEN ${updates.coolingOffUntil !== undefined}::boolean
        THEN ${updates.coolingOffUntil ?? null}::timestamptz ELSE cooling_off_until END,
      status = COALESCE(${updates.status ?? null}::text, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ${userId}
    RETURNING *
  `;
  if (rows.length === 0) return null;
  return userApprovalPinRowSchema.parse(rows[0]);
}

export async function deleteApprovalPin(sql: SqlClient, userId: string): Promise<number> {
  const result = await sql`DELETE FROM user_approval_pins WHERE user_id = ${userId}`;
  return result.count;
}
