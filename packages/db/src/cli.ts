import { createSql } from "./client.ts";
import { parseDatabaseUrl } from "./env.ts";
import { migrate } from "./migrate.ts";

const url = parseDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");

const sql = createSql(url);
try {
  await migrate(sql);
} finally {
  await sql.end();
}
