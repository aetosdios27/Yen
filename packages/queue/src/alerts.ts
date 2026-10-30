import { checkStoredChainStructure, raiseAlert, type Sql } from "@yen/db";
import { parseFundId } from "@yen/shared";
import type { PgBoss } from "pg-boss";
import { escalateDueAlerts } from "./escalation.js";

/**
 * Verifies the stored event chain of every active fund and raises a deduplicated
 * `chain_verification_failure` alert (critical) when a chain is broken.
 */
export async function verifyFundChains(sql: Sql, now: Date = new Date()): Promise<number> {
  const funds = await sql<{ id: string }[]>`
    SELECT id FROM funds WHERE status = 'active' ORDER BY id
  `;
  let failures = 0;
  for (const fund of funds) {
    const parsed = parseFundId(fund.id);
    if (!parsed.ok) continue;
    const result = await checkStoredChainStructure(sql, parsed.value);
    if (result.status !== "structure-consistent") {
      const raised = await raiseAlert(sql, {
        fundId: fund.id,
        alertType: "chain_verification_failure",
        severity: "critical",
        title: "Fund event chain failed verification",
        details: `Chain structure break at index=${result.index} seq=${result.seq ?? "null"}: ${result.reason}`,
        entityType: "fund",
        entityId: fund.id,
        dedupKey: fund.id,
        now,
      });
      if (raised) failures++;
    }
  }
  return failures;
}

/** Escalates due critical alerts every minute. */
export async function registerAlertEscalation(boss: PgBoss, sql: Sql): Promise<void> {
  await boss.createQueue("alert-escalation");
  await boss.work("alert-escalation", { batchSize: 1 }, async () => {
    await escalateDueAlerts(sql);
  });
  await boss.schedule("alert-escalation", "*/1 * * * *", {});
}

/** Re-verifies every fund's stored event chain every five minutes. */
export async function registerChainVerification(boss: PgBoss, sql: Sql): Promise<void> {
  await boss.createQueue("alert-chain-verification");
  await boss.work("alert-chain-verification", { batchSize: 1 }, async () => {
    await verifyFundChains(sql);
  });
  await boss.schedule("alert-chain-verification", "*/5 * * * *", {});
}
