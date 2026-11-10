import { readFile } from "node:fs/promises";
import { createSql } from "./client.ts";
import { parseDatabaseUrl } from "./env.ts";
import { eraseVerifiedGuestContact } from "./privacy-contact.ts";

const [flag, path, ...rest] = process.argv.slice(2);
if (flag !== "--verified-contact-file" || !path || rest.length) {
  process.stderr.write("Usage: privacy:erase-contact --verified-contact-file <private-file>\n");
  process.exitCode = 1;
} else {
  const contact = (await readFile(path, "utf8")).trim();
  const sql = createSql(parseDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL"));
  try {
    process.stdout.write(`${JSON.stringify(await eraseVerifiedGuestContact(sql, contact))}\n`);
  } finally {
    await sql.end();
  }
}
