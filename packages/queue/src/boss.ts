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
  return observePgBossErrors(
    new PgBoss({
      // Library failure spans include raw exception messages; Yen emits id-only spans.
      openTelemetry: { enabled: false },
      connectionString: options.connectionString,
      schema,
      migrate: options.migrate ?? false,
      supervise: true,
    }),
  );
}

/** pg-boss reports asynchronous database and worker failures through this event. */
export function observePgBossErrors(boss: PgBoss): PgBoss {
  boss.on("error", (error: unknown) => {
    logQueueError("pg-boss background operation failed", error);
  });
  return boss;
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
  const boss = observePgBossErrors(
    new PgBoss({
      // Library failure spans include raw exception messages; Yen emits id-only spans.
      openTelemetry: { enabled: false },
      connectionString,
      schema,
      migrate: true,
      supervise: false,
      schedule: false,
    }),
  );
  await boss.start();
  await boss.stop();
}

export function logQueueError(line: string, error: unknown): void {
  const safeToken = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ? value : "unknown";
  const name = error instanceof Error ? safeToken(error.name) : "unknown";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? safeToken(error.code)
      : "unknown";
  process.stderr.write(`${line} name=${name} code=${code}\n`);
}
