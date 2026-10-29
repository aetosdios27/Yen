import type { createSql } from "@yen/db";
import { chainHead, hashHexSchema, verifyChain } from "@yen/eventlog";
import { getFundAccountIds } from "./accounts.js";
import { getFundEvents } from "./eventlog.js";
import { getBalances } from "./operations.js";
import { replayFundEvents } from "./replay.js";

/** Shared post-failure assertion used by chaos tests and restored-dump verification. */
export async function verifyFundState(sql: ReturnType<typeof createSql>, fundId: string) {
  const events = await getFundEvents(sql, fundId);
  const replay = replayFundEvents(fundId, events);
  const balances = await getBalances(sql, fundId);
  if (
    JSON.stringify(replay, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ) !==
    JSON.stringify(balances, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    )
  ) {
    throw new Error(`Ledger and replay diverged for fund ${fundId}`);
  }
  if (events.length) {
    const tail = events.at(-1);
    if (!tail) throw new Error("Expected event tail");
    const verification = await verifyChain(
      events,
      chainHead({
        fundId: fundId as never,
        count: events.length,
        latestHash: hashHexSchema.parse(tail.hash),
      }),
    );
    if (!verification.ok)
      throw new Error(
        `Event chain failed at seq ${verification.seq ?? "unknown"}: ${verification.reason}`,
      );
  }
  const ids = getFundAccountIds(fundId);
  const accounts = [
    ids.bankId,
    ids.donationsId,
    ids.expensesId,
    ids.pendingSpendId,
    ids.pledgedReceivableId,
    ids.donationsPendingId,
  ];
  const journals = await sql<{ balanced: boolean }[]>`
    SELECT bool_and(journal_total = 0) AS balanced FROM (
      SELECT journal_id, SUM(amount) AS journal_total FROM konto_entries
      WHERE account_id = ANY(${accounts}::uuid[]) GROUP BY journal_id
    ) entries
  `;
  if (journals[0]?.balanced === false)
    throw new Error(`Unbalanced ledger journal for fund ${fundId}`);
  const holdTotal = await sql<{ total: string }[]>`
      SELECT COALESCE(SUM(amount), 0)::text AS total FROM konto_holds
      WHERE account_id = ${ids.bankId} AND status = 'PENDING'
    `;
  if (BigInt(holdTotal[0]?.total ?? "0") !== balances.pendingSpendPaise) {
    throw new Error(`Pending holds diverged from ledger balance for fund ${fundId}`);
  }
  return { events, balances };
}
