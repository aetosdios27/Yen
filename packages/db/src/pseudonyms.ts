import { type PseudonymId, pseudonymIdSchema } from "@yen/eventlog";
import { type FundId, parseFundId, parseUserId, type UserId } from "@yen/shared";
import type { SqlClient } from "./client.js";
import { uuidv7 } from "./uuidv7.js";

export interface EnsureFundPseudonymParams {
  userId: UserId | string;
  fundId: FundId | string;
}

/**
 * Ensures an idempotent, race-safe pseudonym mapping for a user within a fund.
 *
 * Each user receives a separate pseudonym per fund to prevent cross-fund linking
 * of individuals across public event logs.
 *
 * Membership check: Do not enforce fund membership here; donors without accounts come later.
 */
export async function ensureFundPseudonym(
  sql: SqlClient,
  { userId, fundId }: EnsureFundPseudonymParams,
): Promise<PseudonymId> {
  const userResult = parseUserId(userId);
  if (!userResult.ok) {
    throw new Error(`Invalid userId: ${userResult.error}`);
  }
  const fundResult = parseFundId(fundId);
  if (!fundResult.ok) {
    throw new Error(`Invalid fundId: ${fundResult.error}`);
  }

  const validUserId = userResult.value;
  const validFundId = fundResult.value;

  // Membership check: Do not enforce fund membership here; donors without accounts come later.
  while (true) {
    const id = uuidv7();
    const inserted = await sql<{ pseudonym_id: string }[]>`
      INSERT INTO fund_pseudonyms (pseudonym_id, user_id, fund_id)
      VALUES (${id}, ${validUserId}, ${validFundId})
      ON CONFLICT (user_id, fund_id) DO NOTHING
      RETURNING pseudonym_id
    `;
    const insertedId = inserted[0]?.pseudonym_id;
    if (insertedId) {
      return pseudonymIdSchema.parse(`psn_${insertedId}`);
    }

    const selected = await sql<{ pseudonym_id: string }[]>`
      SELECT pseudonym_id
      FROM fund_pseudonyms
      WHERE user_id = ${validUserId} AND fund_id = ${validFundId}
    `;
    const selectedId = selected[0]?.pseudonym_id;
    if (selectedId) {
      return pseudonymIdSchema.parse(`psn_${selectedId}`);
    }
  }
}
