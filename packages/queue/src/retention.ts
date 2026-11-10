import { runRetentionJob, type Sql } from "@yen/db";
import type { PgBoss } from "pg-boss";

export async function registerRetention(boss: PgBoss, sql: Sql): Promise<void> {
  await boss.createQueue("privacy-retention");
  await boss.work("privacy-retention", { batchSize: 1 }, async () => {
    await runRetentionJob(sql);
  });
  await boss.schedule("privacy-retention", "0 2 * * *", {});
}
