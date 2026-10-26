import { createSql } from "./client.ts";
import { migrate } from "./migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to run migrations");

const sql = createSql(url);
try {
  await migrate(sql);
} finally {
  await sql.end();
}
