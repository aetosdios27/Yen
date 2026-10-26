import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import type { Sql } from "./client.js";
import { splitSqlStatements } from "./sql-statements.ts";

const defaultDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const appliedSchema = z.array(
  z.object({ version: z.int().positive(), name: z.string(), checksum: z.string() }),
);
const transactionControl = new Set([
  "BEGIN",
  "COMMIT",
  "END",
  "ABORT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "START TRANSACTION",
  "PREPARE TRANSACTION",
  "COMMIT PREPARED",
  "ROLLBACK PREPARED",
]);
const transactionIdSchema = z.object({ id: z.string() });
const stringSettingSchema = z
  .array(z.object({ standard_conforming_strings: z.string() }))
  .length(1);

export async function assertStandardConformingStringsOn(
  show: () => Promise<unknown>,
  context: string,
): Promise<void> {
  try {
    const rows = stringSettingSchema.parse(await show());
    if (rows[0]?.standard_conforming_strings !== "on") {
      throw new Error(`server reported ${rows[0]?.standard_conforming_strings}`);
    }
  } catch (error) {
    throw new Error(`${context}: standard_conforming_strings must be on`, { cause: error });
  }
}

async function readMigrations(dir: string) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(
    names.map(async (name, index) => {
      const match = /^(\d{4})_[a-z][a-z0-9_]*\.sql$/.exec(name);
      if (!match) throw new Error(`Invalid migration filename: ${name}`);
      const version = Number(match[1]);
      if (version !== index + 1) {
        throw new Error(
          `Migration versions must be consecutive: expected ${index + 1}, got ${name}`,
        );
      }
      const bytes = await readFile(join(dir, name));
      const source = bytes.toString("utf8");
      let statements: ReturnType<typeof splitSqlStatements>;
      try {
        statements = splitSqlStatements(source);
      } catch (error) {
        if (error instanceof Error) throw new Error(`${name}: ${error.message}`, { cause: error });
        throw error;
      }
      for (const statement of statements) {
        const [first, second] = statement.leadingKeywords;
        if (
          (first && transactionControl.has(first)) ||
          (first && second && transactionControl.has(`${first} ${second}`))
        ) {
          throw new Error(
            `${name}:${statement.line}: migrations run inside the runner's own transaction`,
          );
        }
        for (const [index, token] of statement.tokens.entries()) {
          if (token.kind === "unsafeString") {
            throw new Error(`${name}:${token.line}: ordinary string ends with a backslash`);
          }
          if (token.kind === "unicodeIdentifier") {
            throw new Error(`${name}:${token.line}: Unicode-escaped identifiers are not permitted`);
          }
          if (token.kind !== "identifier") continue;
          const value = token.value.toLowerCase();
          if (value === "standard_conforming_strings") {
            throw new Error(
              `${name}:${token.line}: migrations may not change standard_conforming_strings`,
            );
          }
          if (value === "set_config" && statement.tokens[index + 1]?.kind === "openParen") {
            const setting = statement.tokens[index + 2];
            const separator = statement.tokens[index + 3];
            if (
              setting?.kind !== "stringLiteral" ||
              separator?.kind !== "comma" ||
              setting.value.toLowerCase().includes("standard_conforming_strings")
            ) {
              throw new Error(`${name}:${token.line}: unsafe set_config first argument`);
            }
          }
        }
      }
      return {
        version,
        name,
        source,
        checksum: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
}

export async function migrate(
  sql: Sql,
  { dir = defaultDir }: { dir?: string } = {},
): Promise<void> {
  const migrations = await readMigrations(dir);
  const connection = await sql.reserve();
  try {
    try {
      await connection`SET standard_conforming_strings = on`;
    } catch (error) {
      throw new Error("Failed to set standard_conforming_strings = on", { cause: error });
    }
    await assertStandardConformingStringsOn(
      () => connection`SHOW standard_conforming_strings`,
      "Before migrations",
    );
    await connection`SELECT pg_advisory_lock(1497714225, 1)`;
    try {
      await connection`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
          version integer PRIMARY KEY CHECK (version > 0),
          name text NOT NULL UNIQUE,
          checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
          applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      const applied = appliedSchema.parse(
        await connection`SELECT version, name, checksum FROM public.schema_migrations ORDER BY version`,
      );
      for (const [index, previous] of applied.entries()) {
        const migration = migrations[index];
        if (previous.version !== index + 1 || !migration || migration.name !== previous.name) {
          throw new Error(`Missing or out-of-order applied migration: ${previous.name}`);
        }
        if (migration.checksum !== previous.checksum) {
          throw new Error(`Applied migration checksum changed: ${migration.name}`);
        }
      }
      for (const migration of migrations.slice(applied.length)) {
        // postgres.js reserved connections lack begin() at runtime; keep transactions on the lock session.
        await connection`BEGIN`;
        try {
          const before = transactionIdSchema.parse(
            (await connection`SELECT txid_current()::text AS id`)[0],
          ).id;
          await connection.unsafe(migration.source).simple();
          const after = transactionIdSchema.parse(
            (await connection`SELECT txid_current()::text AS id`)[0],
          ).id;
          if (before !== after) {
            throw new Error(`${migration.name}: migration ended the runner's own transaction`);
          }
          await assertStandardConformingStringsOn(
            () => connection`SHOW standard_conforming_strings`,
            migration.name,
          );
          await connection`
            INSERT INTO public.schema_migrations (version, name, checksum)
            VALUES (${migration.version}, ${migration.name}, ${migration.checksum})
          `;
          await connection`COMMIT`;
        } catch (error) {
          await connection`ROLLBACK`;
          throw error;
        }
      }
    } finally {
      await connection`SELECT pg_advisory_unlock(1497714225, 1)`;
    }
  } finally {
    connection.release();
  }
}
