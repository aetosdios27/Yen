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
import { assertStandardConformingStringsOn, migrate } from "./migrate.js";
import { splitSqlStatements } from "./sql-statements.js";
import { databaseSuite } from "./test/database.js";

const records = z.array(
  z.object({ version: z.number(), name: z.string(), checksum: z.string(), applied_at: z.date() }),
);
const defaultDir = fileURLToPath(new URL("../migrations/", import.meta.url));

it("checks the post-migration SHOW result before history can be inserted", async () => {
  await expect(
    assertStandardConformingStringsOn(
      async () => [{ standard_conforming_strings: "off" }],
      "0001_change.sql",
    ),
  ).rejects.toThrow("0001_change.sql: standard_conforming_strings must be on");
  await expect(
    assertStandardConformingStringsOn(
      async () => [{ standard_conforming_strings: "on" }],
      "0001_safe.sql",
    ),
  ).resolves.toBeUndefined();
});

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

  it("creates the app tables and records the file checksums", async () => {
    await migrate(sql);
    const tables = z
      .array(z.object({ tablename: z.string() }))
      .parse(
        await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
    expect(tables.map((row) => row.tablename)).toEqual([
      "anchor_event_salts",
      "anchors",
      "auth_otp_attempt_limits",
      "auth_otps",
      "donation_pledges",
      "expense_approvals",
      "expenses",
      "fund_events",
      "fund_notification_daily_usage",
      "fund_pseudonyms",
      "funds",
      "idempotency_keys",
      "memberships",
      "notification_dead_letter",
      "notification_outbox",
      "orgs",
      "pseudonyms",
      "rate_limits",
      "schema_migrations",
      "sessions",
      "trusted_devices",
      "user_approval_pins",
      "user_notification_preferences",
      "users",
      "waitlist_entries",
      "yen_ids",
    ]);
    const source = await readFile(join(defaultDir, "0001_app_tables.sql"));
    const waitlistSource = await readFile(join(defaultDir, "0002_waitlist.sql"));
    const fundEventsSource = await readFile(join(defaultDir, "0003_fund_events.sql"));
    const sharedStoresSource = await readFile(join(defaultDir, "0004_shared_stores.sql"));
    const fundPseudonymsSource = await readFile(join(defaultDir, "0005_fund_pseudonyms.sql"));
    const yenIdsSource = await readFile(join(defaultDir, "0006_yen_ids.sql"));
    const authSource = await readFile(join(defaultDir, "0007_auth_sessions.sql"));
    const authAttemptsSource = await readFile(join(defaultDir, "0008_auth_otp_attempt_limits.sql"));
    const pinsSource = await readFile(join(defaultDir, "0009_approval_pins.sql"));
    const notificationsSource = await readFile(join(defaultDir, "0010_notifications.sql"));
    const donationSource = await readFile(join(defaultDir, "0011_donation_pledges.sql"));
    const expensesSource = await readFile(join(defaultDir, "0012_expenses.sql"));
    const anchorsSource = await readFile(join(defaultDir, "0013_anchors.sql"));
    const trustedDevicesSource = await readFile(join(defaultDir, "0014_trusted_devices.sql"));
    const applied = records.parse(await sql`SELECT * FROM schema_migrations ORDER BY version`);
    expect(applied).toEqual([
      {
        version: 1,
        name: "0001_app_tables.sql",
        checksum: createHash("sha256").update(source).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 2,
        name: "0002_waitlist.sql",
        checksum: createHash("sha256").update(waitlistSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 3,
        name: "0003_fund_events.sql",
        checksum: createHash("sha256").update(fundEventsSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 4,
        name: "0004_shared_stores.sql",
        checksum: createHash("sha256").update(sharedStoresSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 5,
        name: "0005_fund_pseudonyms.sql",
        checksum: createHash("sha256").update(fundPseudonymsSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 6,
        name: "0006_yen_ids.sql",
        checksum: createHash("sha256").update(yenIdsSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 7,
        name: "0007_auth_sessions.sql",
        checksum: createHash("sha256").update(authSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 8,
        name: "0008_auth_otp_attempt_limits.sql",
        checksum: createHash("sha256").update(authAttemptsSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 9,
        name: "0009_approval_pins.sql",
        checksum: createHash("sha256").update(pinsSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 10,
        name: "0010_notifications.sql",
        checksum: createHash("sha256").update(notificationsSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 11,
        name: "0011_donation_pledges.sql",
        checksum: createHash("sha256").update(donationSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 12,
        name: "0012_expenses.sql",
        checksum: createHash("sha256").update(expensesSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 13,
        name: "0013_anchors.sql",
        checksum: createHash("sha256").update(anchorsSource).digest("hex"),
        applied_at: expect.any(Date),
      },
      {
        version: 14,
        name: "0014_trusted_devices.sql",
        checksum: createHash("sha256").update(trustedDevicesSource).digest("hex"),
        applied_at: expect.any(Date),
      },
    ]);
  });

  it("records history when a migration changes its search path", async () => {
    await writeFile(
      join(dir, "0001_search_path.sql"),
      "CREATE SCHEMA app; SET LOCAL search_path = app; CREATE TABLE example (id int);",
    );
    await migrate(sql, { dir });
    expect(await sql`SELECT version FROM public.schema_migrations`).toEqual([{ version: 1 }]);
    expect(await sql`SELECT to_regclass('app.example') AS name`).toEqual([{ name: "app.example" }]);
    await migrate(sql, { dir });
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
    expect(before).toHaveLength(14);
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

  it("forces standard strings on for a database whose default is off", async () => {
    const databaseName = new URL(url).pathname.slice(1);
    await sql`ALTER DATABASE ${sql(databaseName)} SET standard_conforming_strings = off`;
    const other = createSql(url);
    try {
      expect(await other`SHOW standard_conforming_strings`).toEqual([
        { standard_conforming_strings: "off" },
      ]);
      await writeFile(join(dir, "0001_safe.sql"), "CREATE TABLE safe (id integer);");
      await migrate(other, { dir });
      expect(await other`SELECT to_regclass('public.safe') AS name`).toEqual([{ name: "safe" }]);
      expect(await other`SELECT version FROM schema_migrations`).toEqual([{ version: 1 }]);
    } finally {
      await other.end();
      await sql`ALTER DATABASE ${sql(databaseName)} RESET standard_conforming_strings`;
    }
  });

  it("rejects the escaped-quote COMMIT from an off-default database before applying anything", async () => {
    const databaseName = new URL(url).pathname.slice(1);
    await sql`ALTER DATABASE ${sql(databaseName)} SET standard_conforming_strings = off`;
    const other = createSql(url);
    try {
      await writeFile(
        join(dir, "0001_escaped.sql"),
        "CREATE TABLE escaped (id int); SELECT '\\'; SELECT '; COMMIT; --';",
      );
      await expect(migrate(other, { dir })).rejects.toThrow(/0001_escaped\.sql:1/);
      expect(await other`SELECT to_regclass('public.escaped') AS name`).toEqual([{ name: null }]);
      expect(await other`SELECT to_regclass('public.schema_migrations') AS name`).toEqual([
        { name: null },
      ]);
    } finally {
      await other.end();
      await sql`ALTER DATABASE ${sql(databaseName)} RESET standard_conforming_strings`;
    }
  });

  it.each([
    "SET standard_conforming_strings = off;",
    "SET LOCAL standard_conforming_strings = off;",
    "RESET standard_conforming_strings;",
    "SELECT set_config('standard_conforming_strings', 'off', true);",
    'SET "standard_conforming_strings" = off;',
    "ALTER SYSTEM SET standard_conforming_strings = off;",
    "ALTER DATABASE postgres SET standard_conforming_strings = off;",
    "ALTER ROLE postgres SET standard_conforming_strings = off;",
    'SET U&"standard\\005fconforming_strings" = off;',
  ])("rejects a migration that changes string parsing: %s", async (source) => {
    await writeFile(join(dir, "0001_setting.sql"), `-- harmless\n${source}`);
    await expect(migrate(sql, { dir })).rejects.toThrow(/0001_setting\.sql:2/);
    expect(await sql`SELECT to_regclass('public.schema_migrations') AS name`).toEqual([
      { name: null },
    ]);
  });

  it.each([
    "SELECT set_config('standard_conforming_strings', 'off', false);",
    "SELECT set_config('STANDARD_CONFORMING_STRINGS', 'off', false);",
    "SELECT set_config('pg_catalog.standard_conforming_strings', 'off', false);",
    "SELECT set_config(E'standard\\137conforming_strings', 'off', false);",
    "SELECT set_config(E'standard\\x5fconforming_strings', 'off', false);",
    "SELECT set_config(E'standard\\u005fconforming_strings', 'off', false);",
    "SELECT set_config('standard_' || 'conforming_strings', 'off', false);",
    "SELECT set_config(name_col, 'off', false);",
    "SELECT set_config(lower('X'), 'off', false);",
    "SELECT set_config($$search_path$$, 'public', false);",
    "SELECT set_config('search_path'::text, 'public', false);",
  ])("rejects unsafe set_config first arguments: %s", async (source) => {
    await writeFile(join(dir, "0001_setting.sql"), `SELECT 1;\n${source}`);
    await expect(migrate(sql, { dir })).rejects.toThrow(/0001_setting\.sql:2/);
  });

  it.each([
    "SELECT set_config('search_path', 'public', false);",
    "SELECT set_config( /* setting */ E'search_path' /* name */, 'public', false);",
    "SELECT set_config(E'search\\137path', 'public', false);",
    "SELECT set_config(E'search\\x5fpath', 'public', false);",
    "SELECT set_config(E'search\\u005fpath', 'public', false);",
  ])("applies set_config with a safe literal first argument: %s", async (source) => {
    await writeFile(
      join(dir, "0001_setting.sql"),
      `${source}\nCREATE TABLE setting_probe (value text); INSERT INTO setting_probe SELECT current_setting('search_path');`,
    );
    await migrate(sql, { dir });
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([{ version: 1 }]);
    expect(await sql`SELECT value FROM setting_probe`).toEqual([{ value: "public" }]);
  });

  it("still rejects COMMIT after an allowed set_config call", async () => {
    await writeFile(
      join(dir, "0001_setting.sql"),
      "SELECT set_config('search_path', 'public', false);\n/* harmless */ COMMIT;",
    );
    await expect(migrate(sql, { dir })).rejects.toThrow(/0001_setting\.sql:2.*transaction/i);
  });

  it.each([
    ["trailing backslash", "SELECT '\\';", /ordinary string ends with a backslash/],
    [
      "table identifier",
      "CREATE TABLE standard_conforming_strings (id int);",
      /may not change standard_conforming_strings/,
    ],
    [
      "column identifier",
      "CREATE TABLE safe (standard_conforming_strings text);",
      /may not change standard_conforming_strings/,
    ],
  ])("rejects the documented conservative case: %s", async (_case, source, reason) => {
    await writeFile(join(dir, "0001_conservative.sql"), source);
    await expect(migrate(sql, { dir })).rejects.toThrow(
      new RegExp(`0001_conservative\\.sql:1:.*${reason.source}`),
    );
  });

  it("allows setting names inside comments and string literals", async () => {
    await writeFile(
      join(dir, "0001_literals.sql"),
      "-- standard_conforming_strings set_config\nCREATE TABLE accepted (message text);\nINSERT INTO accepted VALUES ('standard_conforming_strings set_config');",
    );
    await migrate(sql, { dir });
    expect(await sql`SELECT message FROM accepted`).toEqual([
      { message: "standard_conforming_strings set_config" },
    ]);
  });

  it("rolls back when a dollar-quoted block turns standard strings off", async () => {
    await writeFile(
      join(dir, "0001_block.sql"),
      "CREATE TABLE escaped (id int); DO $$ BEGIN PERFORM set_config('standard_conforming_strings', 'off', true); END $$;",
    );
    await expect(migrate(sql, { dir })).rejects.toThrow(
      "0001_block.sql: standard_conforming_strings must be on",
    );
    expect(await sql`SELECT to_regclass('public.escaped') AS name`).toEqual([{ name: null }]);
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([]);
  });

  it("rejects COMMIT after a bare carriage return without persisting the table", async () => {
    await writeFile(
      join(dir, "0001_escaped.sql"),
      "CREATE TABLE escaped (id int); -- note\rCOMMIT;",
    );
    await expect(migrate(sql, { dir })).rejects.toThrow(/0001_escaped\.sql:2.*transaction/i);
    expect(await sql`SELECT to_regclass('public.escaped') AS name`).toEqual([{ name: null }]);
    expect(await sql`SELECT to_regclass('public.schema_migrations') AS name`).toEqual([
      { name: null },
    ]);
  });

  it.each([
    ["bare CR", "-- note\rCREATE TABLE accepted (id int); INSERT INTO accepted VALUES (3);"],
    ["form feed", "CREATE\fTABLE accepted (id int); INSERT INTO accepted VALUES (3);"],
    [
      "operator before line comment",
      "CREATE TABLE accepted (id int); INSERT INTO accepted VALUES (1+-- note\r2);",
    ],
    [
      "operator before block comment",
      "CREATE TABLE accepted (id int); INSERT INTO accepted VALUES (1+/* note */2);",
    ],
    [
      "block marker in line comment",
      "-- /* ignored\rCREATE TABLE accepted (id int); INSERT INTO accepted VALUES (3);",
    ],
    [
      "line marker in block comment",
      "/* -- ignored */ CREATE TABLE accepted (id int); INSERT INTO accepted VALUES (3);",
    ],
    [
      "nested block comments",
      "/* outer /* inner */ outer */ CREATE TABLE accepted (id int); INSERT INTO accepted VALUES (3);",
    ],
    [
      "form feed inside line comment",
      "-- note\fCOMMIT;\rCREATE TABLE accepted (id int); INSERT INTO accepted VALUES (3);",
    ],
    [
      "vertical tab inside line comment",
      "-- note\vCOMMIT;\rCREATE TABLE accepted (id int); INSERT INTO accepted VALUES (3);",
    ],
  ])("executes %s with PostgreSQL statement boundaries", async (_name, source) => {
    await writeFile(join(dir, "0001_accepted.sql"), source);
    await migrate(sql, { dir });
    expect(await sql`SELECT id FROM accepted`).toEqual([{ id: 3 }]);
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([{ version: 1 }]);
    expect(splitSqlStatements(source)).toHaveLength(2);
  });

  it("matches PostgreSQL 16's vertical-tab and stray block terminator errors", async () => {
    await expect(sql.unsafe("SELECT 1\vAS value").simple()).rejects.toMatchObject({
      code: "42601",
    });
    await expect(sql.unsafe("SELECT 1 */ 2").simple()).rejects.toMatchObject({ code: "42883" });
    await expect(sql.unsafe("/* outer /* inner */").simple()).rejects.toMatchObject({
      code: "42601",
    });
    expect(splitSqlStatements("SELECT 1\vAS value; SELECT 2;")).toHaveLength(2);
    expect(splitSqlStatements("SELECT 1 */ 2; SELECT 3;")).toHaveLength(2);
  });

  it("rejects NUL bytes before creating migration history", async () => {
    await expect(sql.unsafe("SELECT 1\0SELECT 2").simple()).rejects.toMatchObject({
      code: "08P01",
    });
    await writeFile(join(dir, "0001_nul.sql"), "CREATE TABLE escaped (id int);\0COMMIT;");
    await expect(migrate(sql, { dir })).rejects.toThrow("0001_nul.sql: line 1: NUL byte");
    expect(await sql`SELECT to_regclass('public.escaped') AS name`).toEqual([{ name: null }]);
    expect(await sql`SELECT to_regclass('public.schema_migrations') AS name`).toEqual([
      { name: null },
    ]);
  });

  it.each([
    ["CREATE TABLE escaped (é$$ int); COMMIT; SELECT $$ok$$;", 1],
    ["CREATE TABLE escaped (é$$ int);\nCOMMIT; SELECT $$ok$$;", 2],
  ])("rejects COMMIT after a Unicode identifier in %s", async (source, line) => {
    await writeFile(join(dir, "0001_escaped.sql"), source);
    await expect(migrate(sql, { dir })).rejects.toThrow(
      new RegExp(`0001_escaped\\.sql:${line}.*transaction`, "i"),
    );
    expect(await sql`SELECT to_regclass('public.escaped') AS name`).toEqual([{ name: null }]);
    expect(await sql`SELECT to_regclass('public.schema_migrations') AS name`).toEqual([
      { name: null },
    ]);
  });

  it("accepts a DO block with transaction words inside its dollar quote", async () => {
    await writeFile(join(dir, "0001_block.sql"), "DO $$\nBEGIN\n  PERFORM 1;\nEND\n$$;");
    await migrate(sql, { dir });
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([{ version: 1 }]);
  });

  it("applies a DO block with a Unicode dollar tag", async () => {
    await writeFile(join(dir, "0001_unicode.sql"), "DO $é$ BEGIN PERFORM 1; END $é$;");
    await migrate(sql, { dir });
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([{ version: 1 }]);
  });

  it.each([
    "INSERT INTO boundary_trace SELECT 1 AS é$$; INSERT INTO boundary_trace VALUES (2);",
    "INSERT INTO boundary_trace SELECT 1 AS 𐀀$$; INSERT INTO boundary_trace VALUES (2);",
    "INSERT INTO boundary_trace SELECT 1 AS a$$b; INSERT INTO boundary_trace VALUES (2);",
    "DO $é$ BEGIN INSERT INTO boundary_trace VALUES (1); END $é$; INSERT INTO boundary_trace VALUES (2);",
    "DO $_x$ BEGIN INSERT INTO boundary_trace VALUES (1); END $_x$; INSERT INTO boundary_trace VALUES (2);",
    "DO $a1$ BEGIN INSERT INTO boundary_trace VALUES (1); END $a1$; INSERT INTO boundary_trace VALUES (2);",
    "INSERT INTO boundary_trace SELECT 1 WHERE E'a\\'b' = E'a\\'b'; INSERT INTO boundary_trace VALUES (2);",
    "INSERT INTO boundary_trace SELECT 1 WHERE U&'d\\0061ta' = 'data'; INSERT INTO boundary_trace VALUES (2);",
  ])("matches PostgreSQL statement boundaries in %s", async (source) => {
    const connection = await sql.reserve();
    try {
      await connection`BEGIN`;
      await connection`CREATE TEMP TABLE boundary_trace (statement_index int) ON COMMIT DROP`;
      await connection.unsafe(source).simple();
      const rows =
        await connection`SELECT statement_index FROM boundary_trace ORDER BY statement_index`;
      expect(rows).toEqual([{ statement_index: 1 }, { statement_index: 2 }]);
      expect(splitSqlStatements(source)).toHaveLength(rows.length);
    } finally {
      await connection`ROLLBACK`;
      connection.release();
    }
  });

  it("recognizes $1 as a server parameter, not a dollar quote", async () => {
    expect(splitSqlStatements("SELECT $1")).toHaveLength(1);
    expect(await sql.unsafe("SELECT $1 AS value", [7])).toEqual([{ value: "7" }]);
  });

  it.each([
    ["SELECT 1 AS éE'a\\';", "'a\\'"],
    ["SELECT 1 AS éU&'x';", "&"],
  ])("matches PostgreSQL prefix adjacency in %s", async (source, token) => {
    await expect(sql.unsafe(source).simple()).rejects.toMatchObject({
      code: "42601",
      position: String(source.indexOf(token) + 1),
    });
    expect(splitSqlStatements(`${source} SELECT 2;`)).toHaveLength(2);
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
    await sql`UPDATE schema_migrations SET version = 99 WHERE version = 1`;
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

  it("backfills replay_expires_at and lease_expires_at for rows inserted under 0001-0003", async () => {
    // Copy 0001, 0002, 0003 into dir
    const m1 = await readFile(join(defaultDir, "0001_app_tables.sql"));
    const m2 = await readFile(join(defaultDir, "0002_waitlist.sql"));
    const m3 = await readFile(join(defaultDir, "0003_fund_events.sql"));
    await writeFile(join(dir, "0001_app_tables.sql"), m1);
    await writeFile(join(dir, "0002_waitlist.sql"), m2);
    await writeFile(join(dir, "0003_fund_events.sql"), m3);

    await migrate(sql, { dir });

    // Insert a completed row under the old schema (0001-0003 shape)
    const createdAt = new Date("2026-01-01T10:00:00Z");
    await sql`
      INSERT INTO idempotency_keys (key, request_hash, response, created_at)
      VALUES ('comp-key', 'hash1', '{"status":200}'::jsonb, ${createdAt})
    `;

    // Now copy 0004_shared_stores.sql into dir and migrate
    const m4 = await readFile(join(defaultDir, "0004_shared_stores.sql"));
    await writeFile(join(dir, "0004_shared_stores.sql"), m4);

    await migrate(sql, { dir });

    const [row] = await sql<
      [{ replay_expires_at: Date | null; lease_expires_at: Date | null; created_at: Date }]
    >`
      SELECT replay_expires_at, lease_expires_at, created_at
      FROM idempotency_keys
      WHERE key = 'comp-key'
    `;

    expect(row).toBeDefined();
    expect(row.replay_expires_at).not.toBeNull();
    expect(row.replay_expires_at?.getTime()).toBe(createdAt.getTime() + 24 * 60 * 60 * 1000);
    expect(row.lease_expires_at).toBeNull();
  });
});
