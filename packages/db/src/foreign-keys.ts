import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import type { Sql } from "./client.js";

/**
 * Foreign key indexing verification against PostgreSQL 16 catalogs.
 *
 * Primary PostgreSQL 16 Documentation:
 * - pg_constraint catalog:
 *   https://www.postgresql.org/docs/16/catalog-pg-constraint.html
 * - pg_index catalog:
 *   https://www.postgresql.org/docs/16/catalog-pg-index.html
 * - Foreign key constraints and indexing:
 *   https://www.postgresql.org/docs/16/ddl-constraints.html#DDL-CONSTRAINTS-FK
 *   "Since a DELETE of a row from the referenced table or an UPDATE of a referenced
 *   column will require a scan of the referencing table for rows matching the old value,
 *   it is often a good idea to index the referencing columns too... the declaration
 *   of a foreign key constraint does not automatically create an index on the referencing columns."
 */

export type ForeignKeyViolation = {
  constraintName: string;
  tableName: string;
  foreignTable: string;
  fkColumns: string[];
  reason: string;
};

export type ForeignKeyAllowlistEntry = {
  tableName: string;
  constraintName: string;
  reason: string;
};

const defaultMigrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

const fkCatalogRowSchema = z.object({
  constraint_name: z.string(),
  table_name: z.string(),
  foreign_table: z.string(),
  fk_columns: z.array(z.string()),
  supporting_indexes: z.array(z.string()).nullable(),
});

/**
 * Finds all foreign key constraints in the specified schema (or across all application schemas)
 * lacking a supporting index whose leading key columns cover the constrained foreign key columns.
 *
 * An index supports a foreign key if and only if:
 * 1. It indexes the referencing relation (i.indrelid = c.conrelid).
 * 2. It is currently valid (i.indisvalid = true).
 * 3. It is not a partial index (i.indpred IS NULL), since foreign key integrity spans all rows.
 * 4. Its key column count covers the foreign key (i.indnkeyatts >= cardinality(c.conkey)),
 *    ensuring INCLUDE non-key columns cannot falsely satisfy foreign key columns.
 * 5. The leading key columns of the index match the foreign key constraint columns.
 */
export async function findForeignKeysWithoutIndices(
  sql: Sql,
  options: {
    schema?: string | undefined;
    schemas?: string[] | undefined;
    allowlist?: readonly ForeignKeyAllowlistEntry[] | undefined;
  } = {},
): Promise<ForeignKeyViolation[]> {
  const allowlist = options.allowlist ?? [];
  const rows = options.schema
    ? await sql`
        SELECT
          c.conname AS constraint_name,
          n.nspname || '\.' || rel.relname AS table_name,
          fn.nspname || '\.' || frel.relname AS foreign_table,
          (
            SELECT array_agg(att.attname ORDER BY u.attposition)
            FROM LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, attposition)
            JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = u.attnum
          ) AS fk_columns,
          (
            SELECT array_agg(i.indexrelid::regclass::text)
            FROM pg_index i
            WHERE i.indrelid = c.conrelid
              AND i.indisvalid = true
              AND i.indpred IS NULL
              AND i.indnkeyatts >= cardinality(c.conkey)
              AND (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] <@ c.conkey
              AND c.conkey <@ (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)]
          ) AS supporting_indexes
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        JOIN pg_class frel ON frel.oid = c.confrelid
        JOIN pg_namespace fn ON fn.oid = frel.relnamespace
        WHERE c.contype = 'f'
          AND n.nspname = ${options.schema}
        ORDER BY table_name, constraint_name;
      `
    : options.schemas
      ? await sql`
        SELECT
          c.conname AS constraint_name,
          n.nspname || '\.' || rel.relname AS table_name,
          fn.nspname || '\.' || frel.relname AS foreign_table,
          (
            SELECT array_agg(att.attname ORDER BY u.attposition)
            FROM LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, attposition)
            JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = u.attnum
          ) AS fk_columns,
          (
            SELECT array_agg(i.indexrelid::regclass::text)
            FROM pg_index i
            WHERE i.indrelid = c.conrelid
              AND i.indisvalid = true
              AND i.indpred IS NULL
              AND i.indnkeyatts >= cardinality(c.conkey)
              AND (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] <@ c.conkey
              AND c.conkey <@ (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)]
          ) AS supporting_indexes
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        JOIN pg_class frel ON frel.oid = c.confrelid
        JOIN pg_namespace fn ON fn.oid = frel.relnamespace
        WHERE c.contype = 'f'
          AND n.nspname = ANY(${options.schemas})
        ORDER BY table_name, constraint_name;
      `
      : await sql`
        SELECT
          c.conname AS constraint_name,
          n.nspname || '\.' || rel.relname AS table_name,
          fn.nspname || '\.' || frel.relname AS foreign_table,
          (
            SELECT array_agg(att.attname ORDER BY u.attposition)
            FROM LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, attposition)
            JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = u.attnum
          ) AS fk_columns,
          (
            SELECT array_agg(i.indexrelid::regclass::text)
            FROM pg_index i
            WHERE i.indrelid = c.conrelid
              AND i.indisvalid = true
              AND i.indpred IS NULL
              AND i.indnkeyatts >= cardinality(c.conkey)
              AND (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] <@ c.conkey
              AND c.conkey <@ (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)]
          ) AS supporting_indexes
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        JOIN pg_class frel ON frel.oid = c.confrelid
        JOIN pg_namespace fn ON fn.oid = frel.relnamespace
        WHERE c.contype = 'f'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND n.nspname NOT LIKE 'pg_temp%'
        ORDER BY table_name, constraint_name;
      `;

  const parsed = z.array(fkCatalogRowSchema).parse(rows);
  const violations: ForeignKeyViolation[] = [];

  for (const row of parsed) {
    if (row.supporting_indexes && row.supporting_indexes.length > 0) {
      continue;
    }

    const cleanTableName = row.table_name.includes(".")
      ? (row.table_name.split(".")[1] ?? row.table_name)
      : row.table_name;

    const allowed = allowlist.find(
      (entry) =>
        (entry.tableName === row.table_name || entry.tableName === cleanTableName) &&
        entry.constraintName === row.constraint_name,
    );

    if (allowed) {
      continue;
    }

    violations.push({
      constraintName: row.constraint_name,
      tableName: row.table_name,
      foreignTable: row.foreign_table,
      fkColumns: row.fk_columns,
      reason: `Foreign key "${row.constraint_name}" on table "${row.table_name}" (${row.fk_columns.join(
        ", ",
      )}) -> "${row.foreign_table}" lacks a supporting index on its leading columns.`,
    });
  }

  return violations;
}

/**
 * Asserts that no foreign key in application schemas lacks a supporting index.
 */
export async function assertForeignKeyIndexes(
  sql: Sql,
  options: {
    schema?: string | undefined;
    schemas?: string[] | undefined;
    allowlist?: readonly ForeignKeyAllowlistEntry[] | undefined;
  } = {},
): Promise<void> {
  const violations = await findForeignKeysWithoutIndices(sql, options);
  if (violations.length > 0) {
    const details = violations.map((v) => `  - ${v.reason}`).join("\n");
    throw new Error(
      `Found ${violations.length} foreign key(s) without supporting indexes:\n${details}`,
    );
  }
}

/**
 * Verifies foreign key indexing discipline across every migration built from scratch.
 * Applies migrations one by one to an isolated scratch schema and verifies after
 * each migration that no newly introduced foreign key lacks an index in the same migration.
 */
export async function verifyAllMigrationsForeignKeys(
  sql: Sql,
  options: {
    dir?: string | undefined;
    allowlist?: readonly ForeignKeyAllowlistEntry[] | undefined;
  } = {},
): Promise<{ migrationCount: number; checkedConstraints: number }> {
  const dir = options.dir ?? defaultMigrationsDir;
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const scratchSchema = `yen_fk_verify_${randomUUID().replaceAll("-", "")}`;
  let totalChecked = 0;

  // Use a reserved connection so transaction and search_path state stay bound
  const connection = await sql.reserve();
  const initialSchemas = new Set(
    z
      .array(z.object({ nspname: z.string() }))
      .parse(await connection`SELECT nspname FROM pg_namespace`)
      .map((r) => r.nspname),
  );

  try {
    await connection.unsafe(`CREATE SCHEMA ${scratchSchema}`);
    await connection.unsafe(`SET search_path TO ${scratchSchema}`);

    for (const name of names) {
      const bytes = await readFile(join(dir, name));
      const source = bytes.toString("utf8");
      await connection.unsafe(source).simple();

      const violations = await findForeignKeysWithoutIndices(connection as unknown as Sql, {
        allowlist: options.allowlist,
      });

      if (violations.length > 0) {
        const details = violations.map((v) => `  - ${v.reason}`).join("\n");
        throw new Error(
          `Migration "${name}" introduced foreign key(s) without supporting indexes in the same migration:\n${details}`,
        );
      }

      const currentFks = await connection`
        SELECT count(*)::int AS count
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.contype = 'f'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND n.nspname NOT LIKE 'pg_temp%';
      `;
      const count = z.array(z.object({ count: z.number() })).parse(currentFks)[0]?.count ?? 0;
      totalChecked = Math.max(totalChecked, count);
    }
  } finally {
    try {
      await connection.unsafe(`SET search_path TO public`);
      await connection.unsafe(`DROP SCHEMA IF EXISTS ${scratchSchema} CASCADE`);
      const postSchemas = z
        .array(z.object({ nspname: z.string() }))
        .parse(await connection`SELECT nspname FROM pg_namespace`);
      for (const row of postSchemas) {
        if (!initialSchemas.has(row.nspname) && !row.nspname.startsWith("pg_")) {
          await connection.unsafe(`DROP SCHEMA IF EXISTS ${row.nspname} CASCADE`);
        }
      }
    } finally {
      connection.release();
    }
  }

  return { migrationCount: names.length, checkedConstraints: totalChecked };
}
