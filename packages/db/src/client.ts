import postgres from "postgres";

export function createSql(url: string, options: { readonly max?: number } = {}) {
  return postgres(url, {
    max: options.max ?? 10,
    prepare: true,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { TimeZone: "UTC" },
    types: { bigint: postgres.BigInt },
  });
}

export type Sql = ReturnType<typeof createSql>;
