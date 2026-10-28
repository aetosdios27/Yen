import type { Sql } from "./client.js";
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

export async function getApprovalPin(sql: Sql, userId: string): Promise<UserApprovalPinRow | null> {
  const rows = await sql`
    SELECT * FROM user_approval_pins WHERE user_id = ${userId}
  `;
  if (rows.length === 0) return null;
  return userApprovalPinRowSchema.parse(rows[0]);
}

export async function createApprovalPin(
  sql: Sql,
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
  sql: Sql,
  userId: string,
  updates: UpdateApprovalPinInput,
): Promise<UserApprovalPinRow | null> {
  const current = await getApprovalPin(sql, userId);
  if (!current) return null;

  const rows = await sql`
    UPDATE user_approval_pins SET
      salt = ${updates.salt ?? current.salt},
      pin_hash = ${updates.pinHash ?? current.pin_hash},
      failed_attempts = ${updates.failedAttempts ?? current.failed_attempts},
      total_failed_24h = ${updates.totalFailed24h ?? current.total_failed_24h},
      first_failed_at = ${updates.firstFailedAt !== undefined ? updates.firstFailedAt : current.first_failed_at},
      locked_until = ${updates.lockedUntil !== undefined ? updates.lockedUntil : current.locked_until},
      cooling_off_until = ${updates.coolingOffUntil !== undefined ? updates.coolingOffUntil : current.cooling_off_until},
      status = ${updates.status ?? current.status},
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ${userId}
    RETURNING *
  `;
  if (rows.length === 0) return null;
  return userApprovalPinRowSchema.parse(rows[0]);
}

export async function deleteApprovalPin(sql: Sql, userId: string): Promise<number> {
  const result = await sql`DELETE FROM user_approval_pins WHERE user_id = ${userId}`;
  return result.count;
}
