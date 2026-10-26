import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";

databaseSuite("atomic SQL routine migrations", (sql) => {
  it("executes functions and procedures and guards transaction control", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yen-atomic-"));
    const file = join(dir, "0001_atomic.sql");
    try {
      await writeFile(
        file,
        `
        CREATE FUNCTION answer() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42; END;
        CREATE FUNCTION qualified_answer() RETURNS int LANGUAGE SQL BEGIN ATOMIC
          SELECT x.case FROM (SELECT 42 AS case) x;
        END;
        CREATE FUNCTION alias_answer() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42 AS case; END;
        CREATE FUNCTION implicit_alias_answer() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42 case; END;
        CREATE FUNCTION xml_answer() RETURNS xml LANGUAGE SQL BEGIN ATOMIC SELECT XMLELEMENT(NAME case); END;
        CREATE FUNCTION nested_answer() RETURNS int LANGUAGE SQL BEGIN ATOMIC
          SELECT CASE WHEN true THEN CASE WHEN true THEN 42 ELSE 0 END ELSE 0 END;
        END;
        CREATE PROCEDURE noop() LANGUAGE SQL BEGIN ATOMIC SELECT 1; SELECT 2; END;
        CREATE PROCEDURE empty_noop() LANGUAGE SQL BEGIN ATOMIC END;
        CALL noop();
        CALL empty_noop();
      `,
      );
      await migrate(sql, { dir });
      expect(await sql`SELECT answer() AS value`).toEqual([{ value: 42 }]);
      expect(await sql`SELECT qualified_answer() AS value`).toEqual([{ value: 42 }]);
      expect(await sql`SELECT alias_answer() AS value`).toEqual([{ value: 42 }]);
      expect(await sql`SELECT implicit_alias_answer() AS value`).toEqual([{ value: 42 }]);
      expect(await sql`SELECT xml_answer()::text AS value`).toEqual([{ value: "<case/>" }]);
      expect(await sql`SELECT nested_answer() AS value`).toEqual([{ value: 42 }]);
      expect(await sql`SELECT version FROM public.schema_migrations`).toEqual([{ version: 1 }]);

      for (const control of ["COMMIT", "ROLLBACK", "END TRANSACTION", "BEGIN"]) {
        await writeFile(
          file,
          `CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42; ${control}; END;`,
        );
        await expect(migrate(sql, { dir })).rejects.toThrow(/transaction/i);
        await writeFile(
          file,
          `CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC ${control}; END;`,
        );
        await expect(migrate(sql, { dir })).rejects.toThrow(/transaction/i);
      }
      await writeFile(
        file,
        "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42; END; COMMIT;",
      );
      await expect(migrate(sql, { dir })).rejects.toThrow(/transaction/i);
      for (const routine of [
        "CREATE PROCEDURE p() LANGUAGE SQL BEGIN ATOMIC END;",
        "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42 AS case; END;",
        "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 42 case; END;",
        "CREATE FUNCTION f() RETURNS xml LANGUAGE SQL BEGIN ATOMIC SELECT XMLELEMENT(NAME case); END;",
        "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT x.case FROM (SELECT 42 AS case) x; END;",
      ]) {
        await writeFile(file, `${routine} COMMIT;`);
        await expect(migrate(sql, { dir })).rejects.toThrow(/transaction/i);
      }
      await writeFile(
        file,
        "CREATE FUNCTION f() RETURNS text LANGUAGE SQL BEGIN ATOMIC SELECT set_config('standard_conforming_strings', 'off', false); END;",
      );
      await expect(migrate(sql, { dir })).rejects.toThrow(/set_config/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
