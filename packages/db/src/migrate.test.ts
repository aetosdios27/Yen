import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as z from "zod";
import { createSql } from "./client.js";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";

const records = z.array(
  z.object({ version: z.number(), name: z.string(), checksum: z.string(), applied_at: z.date() }),
);
const defaultDir = fileURLToPath(new URL("../migrations/", import.meta.url));

databaseSuite("migration runner", (sql, url) => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "yen-migrations-"));
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates exactly the six app tables and records the file checksum", async () => {
    await migrate(sql);
    const tables = z
      .array(z.object({ tablename: z.string() }))
      .parse(
        await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
    expect(tables.map((row) => row.tablename)).toEqual([
      "funds",
      "idempotency_keys",
      "memberships",
      "orgs",
      "pseudonyms",
      "schema_migrations",
      "users",
    ]);
    const source = await readFile(join(defaultDir, "0001_app_tables.sql"));
    const applied = records.parse(await sql`SELECT * FROM schema_migrations`);
    expect(applied).toEqual([
      {
        version: 1,
        name: "0001_app_tables.sql",
        checksum: createHash("sha256").update(source).digest("hex"),
        applied_at: expect.any(Date),
      },
    ]);
  });

  it("is a no-op on the second run, including application data and applied_at", async () => {
    await migrate(sql);
    await sql`INSERT INTO idempotency_keys (key, request_hash, response) VALUES ('keep', 'hash', '{}')`;
    const before = records.parse(await sql`SELECT * FROM schema_migrations`);
    await migrate(sql);
    expect(records.parse(await sql`SELECT * FROM schema_migrations`)).toEqual(before);
    expect(await sql`SELECT key FROM idempotency_keys`).toEqual([{ key: "keep" }]);
  });

  it("runs the workspace CLI twice against the throwaway database", async () => {
    const run = () =>
      promisify(execFile)("pnpm", ["--filter", "@yen/db", "migrate"], {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: { ...process.env, DATABASE_URL: url },
      });
    await run();
    const before = records.parse(await sql`SELECT * FROM schema_migrations`);
    await run();
    expect(records.parse(await sql`SELECT * FROM schema_migrations`)).toEqual(before);
    expect(before).toHaveLength(1);
  });

  it("rejects an edited applied file and names it", async () => {
    const file = join(dir, "0001_example.sql");
    await writeFile(file, "CREATE TABLE example (id integer PRIMARY KEY);");
    await migrate(sql, { dir });
    await writeFile(file, "CREATE TABLE different (id integer PRIMARY KEY);");
    await expect(migrate(sql, { dir })).rejects.toThrow(
      "Applied migration checksum changed: 0001_example.sql",
    );
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([{ version: 1 }]);
  });

  it.each([
    ["0002_first.sql"],
    ["0001_first.sql", "0003_gap.sql"],
    ["0001_first.sql", "0001_duplicate.sql"],
  ])("rejects missing or duplicate versions: %s", async (...names) => {
    await Promise.all(names.map((name) => writeFile(join(dir, name), "SELECT 1;")));
    await expect(migrate(sql, { dir })).rejects.toThrow("Migration versions must be consecutive");
  });

  it("applies files in version order regardless of directory creation order", async () => {
    await writeFile(join(dir, "0002_insert.sql"), "INSERT INTO ordered VALUES (1);");
    await writeFile(join(dir, "0001_create.sql"), "CREATE TABLE ordered (id integer PRIMARY KEY);");
    await migrate(sql, { dir });
    expect(await sql`SELECT id FROM ordered`).toEqual([{ id: 1 }]);
  });

  it.each([
    "BEGIN",
    "COMMIT",
    "END",
    "ABORT",
    "ROLLBACK",
    "START TRANSACTION",
    "SAVEPOINT",
    "RELEASE",
    "PREPARE TRANSACTION",
    "COMMIT PREPARED",
    "ROLLBACK PREPARED",
  ])("rejects %s before applying any migration", async (statement) => {
    await writeFile(join(dir, "0001_create.sql"), "CREATE TABLE should_not_exist (id integer);");
    await writeFile(join(dir, "0002_control.sql"), `  ${statement.toLowerCase()};`);
    await expect(migrate(sql, { dir })).rejects.toThrow(
      /0002_control\.sql:1.*migrations run inside the runner's own transaction/i,
    );
    expect(await sql`SELECT to_regclass('public.schema_migrations') AS history`).toEqual([
      { history: null },
    ]);
    expect(await sql`SELECT to_regclass('public.should_not_exist') AS table_name`).toEqual([
      { table_name: null },
    ]);
  });

  it.each([
    "select 1;commit;",
    "BEGIN;",
    "  rollback ;",
    "START  TRANSACTION;",
    "COMMIT AND CHAIN;",
    "SAVEPOINT x;",
    "end;",
  ])("rejects top-level control in %s with its line", async (source) => {
    await writeFile(join(dir, "0001_control.sql"), source);
    await expect(migrate(sql, { dir })).rejects.toThrow(/0001_control\.sql:1.*transaction/i);
    expect(await sql`SELECT to_regclass('public.schema_migrations') AS name`).toEqual([
      { name: null },
    ]);
  });

  it("accepts transaction words in comments and non-statement-start string literals", async () => {
    await writeFile(
      join(dir, "0001_safe.sql"),
      "-- COMMIT\nCREATE TABLE safe (message text);\nINSERT INTO safe VALUES ('COMMIT');",
    );
    await migrate(sql, { dir });
    expect(await sql`SELECT message FROM safe`).toEqual([{ message: "COMMIT" }]);
  });

  it("rejects same-line COMMIT before creating a table or history", async () => {
    await writeFile(join(dir, "0001_hidden.sql"), "CREATE TABLE hidden (id integer); COMMIT;");
    await expect(migrate(sql, { dir })).rejects.toThrow(/0001_hidden\.sql:1.*transaction/i);
    expect(await sql`SELECT to_regclass('public.hidden') AS name`).toEqual([{ name: null }]);
    expect(await sql`SELECT to_regclass('public.schema_migrations') AS name`).toEqual([
      { name: null },
    ]);
  });

  it("accepts a DO block with transaction words inside its dollar quote", async () => {
    await writeFile(join(dir, "0001_block.sql"), "DO $$\nBEGIN\n  PERFORM 1;\nEND\n$$;");
    await migrate(sql, { dir });
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([{ version: 1 }]);
  });

  it.each([
    "SELECT 'unfinished",
    "SELECT E'unfinished\\'",
    'SELECT "unfinished',
    "SELECT $body$ unfinished $$",
    "/* outer /* inner */",
  ])("names the file for unterminated SQL in %s", async (source) => {
    await writeFile(join(dir, "0001_invalid.sql"), source);
    await expect(migrate(sql, { dir })).rejects.toThrow(/0001_invalid\.sql: line 1: unterminated/);
    expect(await sql`SELECT to_regclass('public.schema_migrations') AS name`).toEqual([
      { name: null },
    ]);
  });

  it("rolls back a DO block that tries to commit its transaction", async () => {
    await writeFile(
      join(dir, "0001_block.sql"),
      "DO $$ BEGIN CREATE TABLE escaped_do (id int); COMMIT; END $$;",
    );
    await expect(migrate(sql, { dir })).rejects.toThrow();
    expect(await sql`SELECT to_regclass('public.escaped_do') AS name`).toEqual([{ name: null }]);
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([]);
  });

  it("rejects an invalid SQL migration filename", async () => {
    await writeFile(join(dir, "001_wrong.sql"), "SELECT 1;");
    await expect(migrate(sql, { dir })).rejects.toThrow(
      "Invalid migration filename: 001_wrong.sql",
    );
  });

  it("rejects removal or renaming of an applied file", async () => {
    await writeFile(join(dir, "0001_example.sql"), "SELECT 1;");
    await migrate(sql, { dir });
    await rm(join(dir, "0001_example.sql"));
    await expect(migrate(sql, { dir })).rejects.toThrow("0001_example.sql");
    await writeFile(join(dir, "0001_renamed.sql"), "SELECT 1;");
    await expect(migrate(sql, { dir })).rejects.toThrow("0001_example.sql");
  });

  it("rejects an out-of-order applied history", async () => {
    await migrate(sql);
    await sql`UPDATE schema_migrations SET version = 2`;
    await expect(migrate(sql)).rejects.toThrow("Missing or out-of-order applied migration");
  });

  it("rolls back a failed migration, keeps prior migrations, and releases the lock for retry", async () => {
    await writeFile(join(dir, "0001_prior.sql"), "CREATE TABLE prior (id integer PRIMARY KEY);");
    const file = join(dir, "0002_retry.sql");
    await writeFile(
      file,
      "CREATE TABLE retry (id integer PRIMARY KEY); SELECT missing FROM retry;",
    );
    await expect(migrate(sql, { dir })).rejects.toThrow();
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([{ version: 1 }]);
    expect(await sql`SELECT to_regclass('public.retry') AS name`).toEqual([{ name: null }]);
    await writeFile(file, "CREATE TABLE retry (id integer PRIMARY KEY);");
    await migrate(sql, { dir });
    expect(await sql`SELECT version FROM schema_migrations ORDER BY version`).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
  });

  it("serializes two independent runners and applies each migration once", async () => {
    await writeFile(
      join(dir, "0001_create.sql"),
      "SELECT pg_sleep(0.2); CREATE TABLE once_only (id integer PRIMARY KEY);",
    );
    await writeFile(join(dir, "0002_insert.sql"), "INSERT INTO once_only VALUES (1);");
    const other = createSql(url);
    try {
      await Promise.all([migrate(sql, { dir }), migrate(other, { dir })]);
    } finally {
      await other.end();
    }
    expect(await sql`SELECT id FROM once_only`).toEqual([{ id: 1 }]);
    expect(await sql`SELECT version FROM schema_migrations ORDER BY version`).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
  });
});
