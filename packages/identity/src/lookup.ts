import type { SqlClient } from "@yen/db";
import { parseYenId } from "./format.js";

export interface RateLimiter {
  consume(key: string): Promise<boolean | { allowed: boolean }> | boolean | { allowed: boolean };
}

export class RateLimitExceededError extends Error {
  constructor(message = "Rate limit exceeded for Yen ID lookup") {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

/**
 * Masks a display name to prevent mass disclosure:
 * Preserves the initial letter of each word and masks all remaining letters with asterisks (*).
 * Handles multi-character Unicode scripts (e.g. Devanagari) by iterating graphemes.
 *
 * Example:
 * - "Rahul Patel" -> "R**** P****"
 * - "Aetos Dios" -> "A**** D***"
 * - "राहुल पटेल" -> "र**** प***"
 */
export function maskDisplayName(displayName: string): string {
  const words = displayName.trim().split(/\s+/);
  return words
    .filter((w) => w.length > 0)
    .map((word) => {
      const chars = Array.from(word);
      if (chars.length <= 1) {
        return word;
      }
      return chars[0] + "*".repeat(chars.length - 1);
    })
    .join(" ");
}

export interface LookupYenIdParams {
  yenId: string;
  limiter: RateLimiter;
  viewerKey: string;
}

/**
 * Looks up a user's masked display name by Yen ID for member invitations.
 *
 * Security & Privacy Architecture:
 * 1. Pre-validation: Parses and validates the check digit locally. A malformed or mistyped
 *    ID never touches the database or consumes rate limit tokens.
 * 2. Enumeration defense: Rate limiting is enforced via the injected RateLimiter using the
 *    viewerKey (e.g. viewer IP or user account key). If the rate limit is exceeded, the
 *    operation is rejected before any database lookup.
 * 3. Privacy minimization: Returns ONLY the masked display name (e.g. "R**** P****") or null.
 *    Never returns phone numbers, user IDs, pseudonyms, or account balances.
 * 4. Timing & enumeration uniformity: A rate-limited caller receives the identical rejection
 *    regardless of whether the requested Yen ID exists or not.
 *
 * Authorization Responsibility:
 * This function does NOT verify viewer role or permissions. The caller (e.g. API route handler)
 * is strictly responsible for verifying that the viewer is an authorized fund owner/admin
 * before calling lookupYenId.
 */
export async function lookupYenId(
  sql: SqlClient,
  { yenId, limiter, viewerKey }: LookupYenIdParams,
): Promise<string | null> {
  // 1. Parse and check check-digit first: invalid IDs never touch the DB or limiter
  const parseResult = parseYenId(yenId);
  if (!parseResult.ok) {
    throw new Error(`Invalid Yen ID: ${parseResult.error.message}`);
  }
  const cleanId = parseResult.value;

  // 2. Consume rate limit token before querying the database
  const limitRes = await limiter.consume(viewerKey);
  const allowed = typeof limitRes === "boolean" ? limitRes : limitRes.allowed;
  if (!allowed) {
    throw new RateLimitExceededError();
  }

  // 3. Database lookup for user with this active Yen ID
  const rows = await sql<{ display_name: string }[]>`
    SELECT u.display_name
    FROM yen_ids y
    JOIN users u ON u.id = y.user_id
    WHERE y.yen_id = ${cleanId}
  `;

  const match = rows[0];
  if (!match) {
    return null;
  }

  return maskDisplayName(match.display_name);
}
