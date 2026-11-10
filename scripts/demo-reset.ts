import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSql, parseDatabaseUrl, seedDevDatabase } from "@yen/db";
import { formatInr } from "@yen/shared";

/**
 * The API dev server resolves EVIDENCE_STORAGE_DIR against its own working
 * directory (apps/api) and falls back to .data/evidence there, so cleanup
 * mirrors that resolution instead of inventing a separate location.
 */
const API_PACKAGE_DIR = "apps/api";
const DEV_EVIDENCE_DIR = ".data/evidence";

export const DEFAULT_QUEUE_SCHEMA = "pgboss";
const QUEUE_SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export class UnsafePathError extends Error {}

/**
 * Resolves the evidence storage directory to clean, honouring the same env var
 * the API reads. Relative configured paths resolve against apps/api, matching
 * the dev server cwd; the development default is apps/api/.data/evidence.
 */
export function resolveEvidenceStorageDir(
  env: Pick<NodeJS.ProcessEnv, "EVIDENCE_STORAGE_DIR">,
  root = repoRoot(),
): string {
  const configured = env.EVIDENCE_STORAGE_DIR?.trim();
  const base = resolve(root, API_PACKAGE_DIR);
  if (!configured) return resolve(base, ...DEV_EVIDENCE_DIR.split("/"));
  return isAbsolute(configured) ? configured : resolve(base, configured);
}

/**
 * Validates the pg-boss queue schema name from QUEUE_SCHEMA. The identifier is
 * interpolated into SQL by pg-boss itself, so only plain lowercase identifiers
 * are accepted (same contract as packages/queue env validation).
 */
export function resolveQueueSchemaName(env: Pick<NodeJS.ProcessEnv, "QUEUE_SCHEMA">): string {
  const configured = env.QUEUE_SCHEMA?.trim();
  if (!configured) return DEFAULT_QUEUE_SCHEMA;
  if (!QUEUE_SCHEMA_PATTERN.test(configured)) {
    throw new Error(
      "QUEUE_SCHEMA must be 1-63 lowercase letters, digits or underscores, not starting with a digit",
    );
  }
  return configured;
}

/**
 * Guards against deleting the filesystem root, the repo root, or anything
 * above the repo root. Explicitly configured absolute paths outside the repo
 * remain allowed because they are deliberate operator configuration.
 */
export function assertSafeCleanupTarget(target: string, root = repoRoot()): void {
  const resolved = resolve(target);
  if (!isAbsolute(resolved)) {
    throw new UnsafePathError(`Refusing to clean relative path: ${resolved}`);
  }
  if (resolved === resolve("/")) {
    throw new UnsafePathError("Refusing to clean the filesystem root");
  }
  if (resolved === resolve(root)) {
    throw new UnsafePathError("Refusing to clean the repository root");
  }
  if (resolve(root).startsWith(`${resolved}${sep}`)) {
    throw new UnsafePathError(`Refusing to clean a parent of the repository root: ${resolved}`);
  }
}

async function countFilesRecursively(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).length;
}

/**
 * Removes a directory tree after safety checks. Returns the number of files
 * deleted; a missing directory is reported as zero files, not an error.
 */
export async function cleanDirectory(
  target: string,
  root = repoRoot(),
): Promise<{ path: string; filesRemoved: number }> {
  assertSafeCleanupTarget(target, root);
  const resolved = resolve(target);
  if (!existsSync(resolved)) {
    return { path: resolved, filesRemoved: 0 };
  }
  const filesRemoved = await countFilesRecursively(resolved);
  await rm(resolved, { recursive: true, force: true });
  return { path: resolved, filesRemoved };
}

export async function resetEvidenceStorage(
  env: Pick<NodeJS.ProcessEnv, "EVIDENCE_STORAGE_DIR">,
  root = repoRoot(),
): Promise<{ path: string; filesRemoved: number }> {
  return cleanDirectory(resolveEvidenceStorageDir(env, root), root);
}

/** Drops the pg-boss queue schema so no jobs, schedules or dead letters survive. */
export function dropQueueSchemaSql(schema: string): string {
  const validated = resolveQueueSchemaName({ QUEUE_SCHEMA: schema });
  return `DROP SCHEMA IF EXISTS "${validated}" CASCADE;`;
}

export async function main(): Promise<void> {
  const root = repoRoot();
  const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/postgres";
  const parsedUrl = parseDatabaseUrl(databaseUrl, "DATABASE_URL");
  const queueSchema = resolveQueueSchemaName(process.env);

  process.stdout.write("\n======================================================\n");
  process.stdout.write(" Yen Demo Reset (database, evidence, queue, chain)\n");
  process.stdout.write("======================================================\n\n");

  process.stdout.write("1. Cleaning local evidence uploads...\n");
  const evidence = await resetEvidenceStorage(process.env, root);
  if (evidence.filesRemoved > 0) {
    process.stdout.write(`   Removed ${evidence.filesRemoved} file(s) from ${evidence.path}\n`);
  } else {
    process.stdout.write(`   Nothing to clean at ${evidence.path}\n`);
  }

  process.stdout.write("2. Dropping queue schema so no jobs or dead letters survive...\n");
  process.stdout.write(`   Queue schema: ${queueSchema}\n`);

  process.stdout.write("3. Tearing down database (including anchor chain state)...\n");
  const sql = createSql(parsedUrl);
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO public;");
    await sql.unsafe(dropQueueSchemaSql(queueSchema));

    process.stdout.write("4. Running migrations and reseeding demo dataset...\n");
    const result = await seedDevDatabase(sql);

    process.stdout.write("\n======================================================\n");
    process.stdout.write(" Demo Reset Complete\n");
    process.stdout.write("======================================================\n");
    process.stdout.write(`Organization:    ${result.org.name}\n`);
    process.stdout.write(`Active Fund:     ${result.fund.title} (VPA: ${result.fund.upiVpa})\n`);
    process.stdout.write(
      `Seeded Users:    ${result.users.length} users with active mock sessions\n`,
    );
    process.stdout.write(
      `Expenses:        ${result.expenses.length} expense requests (approved, pending, paid)\n`,
    );
    process.stdout.write(
      `Ledger Balance:  ${formatInr(result.ledger.currentBalancePaise)} (Zero-Sum Verified)\n`,
    );
    process.stdout.write(`Chained Events:  ${result.eventCount} immutable audit events\n`);
    process.stdout.write("======================================================\n");
    process.stdout.write("Clean slate ready. Start the demo with: pnpm dev:full\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function repoRoot(): string {
  return fileURLToPath(new URL("..", import.meta.url));
}

// Run when executed directly; tests import the exported helpers instead.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `Error during demo reset: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exit(1);
  });
}
