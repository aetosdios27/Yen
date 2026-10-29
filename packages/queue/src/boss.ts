import { PgBoss } from "pg-boss";
import { DEFAULT_SCHEMA } from "./config.js";
import type { WorkerRuntimeOptions } from "./types.js";

/**
 * Creates a PgBoss instance with Yen production defaults:
 * - Isolated pgboss schema
 * - Explicit migrate setting (defaulting to false to prevent untracked DDL in production)
 */
export function createPgBoss(options: WorkerRuntimeOptions): PgBoss {
  const schema = options.schema ?? DEFAULT_SCHEMA;
  return new PgBoss({
    connectionString: options.connectionString,
    schema,
    migrate: options.migrate ?? false,
    supervise: true,
  });
}

/**
 * Explicit schema initialization helper.
 * Call this during deployment / migration verification to install or upgrade
 * the pgboss schema before starting workers.
 */
export async function ensureQueueSchema(
  connectionString: string,
  schema: string = DEFAULT_SCHEMA,
): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    schema,
    migrate: true,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  await boss.stop();
}
