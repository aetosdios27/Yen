import { readFile } from "node:fs/promises";
import { createSql } from "@yen/db";
import { verifyRestoredDatabase } from "../dist/restore.js";

const url = process.env.YEN_TEST_DATABASE_URL;
const manifest = process.env.YEN_RESTORE_MANIFEST;
if (!url || !manifest)
  throw new Error("YEN_TEST_DATABASE_URL and YEN_RESTORE_MANIFEST are required");
const sql = createSql(url);
try {
  const result = await verifyRestoredDatabase(sql, JSON.parse(await readFile(manifest, "utf8")));
  console.log(`Restored database verified: funds=${result.funds} anchors=${result.anchors}`);
} finally {
  await sql.end();
}
