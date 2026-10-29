import postgres from "postgres";

export interface SqlOptions {
  readonly max?: number;
  readonly connectTimeout?: number;
  readonly idleTimeout?: number;
  readonly prepare?: boolean;
}

// Postgres connection pool options.
// Default max connections: 10.
// Default idle timeout: 20 seconds.
// Default connect / acquire timeout: 10 seconds.
//
// PgBouncer compatibility notes:
// - Session state: Connection is established with TimeZone: "UTC" at startup parameters,
//   avoiding runtime SET commands that leak across transactions.
// - Advisory locks: PgBouncer in transaction mode requires transaction-scoped advisory
//   locks (`pg_advisory_xact_lock`), not session-level locks (`pg_advisory_lock`), because
//   connections are recycled between transactions.
//   Primary doc: https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
// - Prepared statements: Session-level named prepared statements are unsafe in PgBouncer
//   transaction mode without `max_prepared_statements` configured in PgBouncer (1.21.0+).
//   Pass `prepare: false` when using PgBouncer transaction mode without named statement support.
//   Primary docs: https://www.pgbouncer.org/features.html
//   https://github.com/porsager/postgres#prepared-statements
export function createSql(url: string, options: SqlOptions = {}) {
  return postgres(url, {
    max: options.max ?? 10,
    prepare: options.prepare ?? true,
    idle_timeout: options.idleTimeout ?? 20,
    connect_timeout: options.connectTimeout ?? 10,
    onnotice: () => {},
    connection: { TimeZone: "UTC" },
    types: { bigint: postgres.BigInt },
  });
}

export type Sql = ReturnType<typeof createSql>;
export type TransactionSql = postgres.TransactionSql<{ bigint: bigint }>;
export type SqlClient = postgres.ISql<{ bigint: bigint }>;

export function isSql(client: SqlClient): client is Sql {
  return "begin" in client && typeof (client as { begin?: unknown }).begin === "function";
}
