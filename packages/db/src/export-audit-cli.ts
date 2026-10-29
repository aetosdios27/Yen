#!/usr/bin/env node
import { fundIdSchema } from "@yen/shared";
import { exportAuditBundle } from "./audit-bundle.js";
import { createSql } from "./client.js";
import { parseDatabaseUrl } from "./env.js";

const options = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) {
    console.error("Usage: yen-export-audit-bundle --fund UUID --anchor UUID --contract 0xADDRESS");
    process.exit(2);
  }
  options.set(key, value);
}
const databaseUrl = process.env.YEN_DATABASE_URL;
const fund = options.get("--fund");
const anchor = options.get("--anchor");
const contract = options.get("--contract");
if (!databaseUrl || !fund || !anchor || !contract) {
  console.error(
    "Usage: YEN_DATABASE_URL=postgres://... yen-export-audit-bundle --fund UUID --anchor UUID --contract 0xADDRESS",
  );
  process.exit(2);
}
const sql = createSql(parseDatabaseUrl(databaseUrl, "YEN_DATABASE_URL"));
try {
  const bundle = await exportAuditBundle(sql, fundIdSchema.parse(fund), anchor, contract);
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
} catch (error) {
  console.error(`Could not export audit bundle: ${String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
