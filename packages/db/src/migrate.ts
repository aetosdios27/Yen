import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import type { Sql } from "./client.js";

const defaultDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const appliedSchema = z.array(
  z.object({ version: z.int().positive(), name: z.string(), checksum: z.string() }),
);

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
      return {
        version,
        name,
        source: bytes.toString("utf8"),
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
    await connection`SELECT pg_advisory_lock(1497714225, 1)`;
    try {
      await connection`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version integer PRIMARY KEY CHECK (version > 0),
          name text NOT NULL UNIQUE,
          checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
          applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      const applied = appliedSchema.parse(
        await connection`SELECT version, name, checksum FROM schema_migrations ORDER BY version`,
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
          await connection.unsafe(migration.source).simple();
          await connection`
            INSERT INTO schema_migrations (version, name, checksum)
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
