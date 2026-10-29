import { createSql } from "@yen/db";
import { verifyFundState } from "../dist/chaos.js";

const url = process.env.YEN_TEST_DATABASE_URL;
const fundId = process.env.YEN_RESTORE_FUND_ID;
if (!url || !fundId) throw new Error("YEN_TEST_DATABASE_URL and YEN_RESTORE_FUND_ID are required");
const sql = createSql(url);
try {
  const result = await verifyFundState(sql, fundId);
  console.log(
    `Restored fund verified: events=${result.events.length} bankPaise=${result.balances.bankPaise}`,
  );
} finally {
  await sql.end();
}
