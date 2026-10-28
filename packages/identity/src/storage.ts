import type { SqlClient } from "@yen/db";
import { parseUserId, type UserId } from "@yen/shared";
import { generateYenId, type YenId } from "./format.js";

export interface AssignYenIdOptions {
  /**
   * Optional generator hook for deterministic collision testing.
   */
  idGenerator?: () => YenId;
}

/**
 * Assigns a 9-digit Yen ID to a user account.
 *
 * Invariants:
 * - One Yen ID per user account (assigned to users.id, not the phone number).
 * - Permanent: once assigned, the same Yen ID is returned forever.
 * - Idempotent and race-safe: concurrent invocations return the single issued ID.
 * - Collision resilient: if a randomly generated candidate collides with an existing
 *   Yen ID in the table, it automatically generates a new candidate and retries.
 * - Re-issue prevention: when a user is deleted, ON DELETE SET NULL keeps a tombstone row
 *   in yen_ids with user_id = null. Because yen_id is PRIMARY KEY, the tombstone prevents
 *   the ID from ever being assigned to any subsequent account.
 */
export async function assignYenId(
  sql: SqlClient,
  userId: UserId | string,
  options: AssignYenIdOptions = {},
): Promise<YenId> {
  const userResult = parseUserId(userId);
  if (!userResult.ok) {
    throw new Error(`Invalid userId: ${userResult.error}`);
  }
  const validUserId = userResult.value;
  const generate = options.idGenerator ?? generateYenId;

  // 1. Fast path: check if user already has an assigned Yen ID
  const existing = await sql<{ yen_id: string }[]>`
    SELECT yen_id FROM yen_ids WHERE user_id = ${validUserId}
  `;
  if (existing[0]?.yen_id) {
    return existing[0].yen_id as YenId;
  }

  // 2. Generation & insertion loop with race and collision resolution
  while (true) {
    const candidate = generate();
    try {
      const inserted = await sql<{ yen_id: string }[]>`
        INSERT INTO yen_ids (yen_id, user_id)
        VALUES (${candidate}, ${validUserId})
        ON CONFLICT (user_id) DO NOTHING
        RETURNING yen_id
      `;
      if (inserted[0]?.yen_id) {
        return inserted[0].yen_id as YenId;
      }

      // If nothing returned, another concurrent worker inserted an ID for this user.
      const current = await sql<{ yen_id: string }[]>`
        SELECT yen_id FROM yen_ids WHERE user_id = ${validUserId}
      `;
      if (current[0]?.yen_id) {
        return current[0].yen_id as YenId;
      }
    } catch (err: unknown) {
      const error = err as { code?: string; constraint_name?: string };
      // 23505 is PostgreSQL unique_violation
      if (error?.code === "23505") {
        // If a concurrent worker completed assignment for this user, return it
        const current = await sql<{ yen_id: string }[]>`
          SELECT yen_id FROM yen_ids WHERE user_id = ${validUserId}
        `;
        if (current[0]?.yen_id) {
          return current[0].yen_id as YenId;
        }
        // Otherwise candidate collided on PRIMARY KEY (yen_id); retry with fresh candidate.
        continue;
      }
      throw err;
    }
  }
}
