import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createSql } from "@yen/db";
import { paise } from "@yen/shared";
import { expect, it } from "vitest";
import { verifyFundState } from "./chaos.js";
import { recordDonation } from "./operations.js";
import { createLedgerTestFund, ledgerDatabaseSuite } from "./test/database.js";

const container = process.env.YEN_CHAOS_CONTAINER;
ledgerDatabaseSuite("YEN-61 Postgres container restart", (sql, url) => {
  (container ? it : it.skip)(
    "restarts after a write load and verifies durable committed operations",
    async () => {
      const fundId = await createLedgerTestFund(sql);
      for (let i = 0; i < 10; i += 1) {
        await sql.begin((tx) =>
          recordDonation(tx, {
            fundId,
            amount: paise(1000),
            reference: `restart-drill-${i}`,
          }),
        );
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn("podman", ["restart", container as string], { stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`podman restart exited ${code}`)),
        );
      });
      await delay(1000);
      const recoveredSql = createSql(url);
      try {
        const { events, balances } = await verifyFundState(recoveredSql, fundId);
        expect(events).toHaveLength(20);
        expect(balances.bankPaise).toBe(10000n);
      } finally {
        await recoveredSql.end();
      }
    },
    60_000,
  );
});
