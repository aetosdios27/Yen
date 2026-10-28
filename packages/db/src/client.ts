import postgres from "postgres";

export function createSql(
  url: string,
  options: {
    readonly max?: number;
    readonly connectTimeout?: number;
    readonly idleTimeout?: number;
  } = {},
) {
  return postgres(url, {
    max: options.max ?? 10,
    prepare: true,
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
