import type { Sql } from "@yen/db";
import type { PgBoss } from "pg-boss";
import type { EnqueueOptions } from "./types.js";

export type SqlTransaction = Parameters<Parameters<Sql["begin"]>[1]>[0];
export type SqlQueryable = Sql | SqlTransaction;

/**
 * Wraps a Postgres.js client or transaction into an IDatabase adapter
 * conforming to pg-boss's executeSql interface.
 */
export function createPostgresAdapter(tx: SqlQueryable) {
  return {
    async executeSql(text: string, values?: unknown[]) {
      const rows = (await tx.unsafe(
        text,
        (values ?? []) as Parameters<typeof tx.unsafe>[1],
      )) as unknown[];
      return { rows: Array.from(rows) };
    },
  };
}

/**
 * Builds a deterministic idempotency key for domain background jobs.
 */
export function buildIdempotencyKey(domain: string, entityId: string, eventId: string): string {
  return `${domain}:${entityId}:${eventId}`;
}

/**
 * Outbox helper: enqueues a job into pg-boss inside a caller-owned transaction.
 *
 * If the caller transaction commits, the job is durably enqueued.
 * If the caller transaction aborts/rolls back, the job insert is rolled back with it.
 */
export async function transactionalEnqueue<T extends object>(
  boss: PgBoss,
  tx: SqlQueryable,
  queueName: string,
  data: T,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const db = createPostgresAdapter(tx);
  return boss.send(queueName, data, {
    ...options,
    db,
  } as Parameters<typeof boss.send>[2]);
}
