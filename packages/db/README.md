# @yen/db

Postgres.js client, application row schemas, and the v1 SQL schema for YEN-18.

## ADR: SQL owns the database schema

**Context.** Konto uses plain SQL on postgres.js. The event log needs database triggers and privilege rules that must remain visible during review.

**Options considered.** An ORM with generated migrations, Drizzle Kit with a TypeScript schema, or reviewed SQL files with a small postgres.js runner.

**Decision.** Use plain SQL and forward-only migrations. Generate UUIDv7 primary keys in the application with `uuidv7()`; UUID columns have no defaults. Use `timestamptz` for instants and UTC sessions. Store money as `bigint` paise with nonnegative CHECK constraints. Use CHECKed text for membership roles, statuses, and fund visibility so later SQL migrations can change the allowed values without managing Postgres enum types. `legal_form` remains unconstrained text until the domain defines its allowed values.

**Consequences.** SQL is the source of truth. Schema changes require a new migration and matching row-schema changes. Each migration must fit in one transaction. Deployments cannot roll back the schema; corrections require another forward migration. No ORM or query-builder layer sits between callers and Postgres.

PII belongs only in application tables. `pseudonyms` is an erasable mapping from a public UUID to a user. Historical records store the UUID value without a foreign key to this mapping. They must never cascade from the mapping: deleting it must preserve the historical record. All app foreign keys use the default restrictive delete behavior. No event, donation, or expense tables are part of this package's v1 migration.

The five fund roles are `owner`, `treasurer`, `approver`, `auditor`, and `member`. Multiple roles per user and fund are valid. Membership status is explicit on insert. Idempotency keys are globally unique and store a required request hash and completed JSON response; the API owns request hashing, concurrency, replay, and retention.

## Use typed rows

`createSql(url)` returns a postgres.js client with at most 10 connections, prepared statements, a 10-second connection timeout, a 20-second idle timeout, quiet notices, and UTC sessions. Close the client with `await sql.end()`.

Parse query results with the exported `userRowSchema`, `orgRowSchema`, `fundRowSchema`, `membershipRowSchema`, `pseudonymRowSchema`, or `idempotencyKeyRowSchema`. Each schema has a corresponding inferred `*Row` type. ID parsing uses `@yen/shared`'s branded `UserId`, `OrgId`, and `FundId` parsers.

User phones are stored only in canonical E.164 form and parsed as `PhoneE164` from `@yen/shared`. Converting free text such as `98765 43210` to `+919876543210` belongs to the login flow (YEN-22) and needs a product decision; the database and shared parser do not guess country codes.

```ts
import { createSql, fundRowSchema } from "@yen/db";

const sql = createSql(databaseUrl);
try {
  const rows = await sql`SELECT * FROM funds WHERE id = ${fundId}`;
  const fund = fundRowSchema.parse(rows[0]);
} finally {
  await sql.end();
}
```

Postgres `bigint` values remain JavaScript `bigint`, including values beyond `Number.MAX_SAFE_INTEGER`. `@yen/shared`'s `Paise` is a safe-integer number: callers must range-check before conversion and call `paise()` at that boundary. JSON responses must encode bigint values explicitly, for example as decimal strings. `uuidv7()` uses the current Unix milliseconds and cryptographic randomness; IDs within a millisecond are unique probabilistically and are not monotonically ordered.

## Run migrations

From the workspace root, set `DATABASE_URL` to the database you intend to migrate:

```sh
DATABASE_URL=postgres://postgres:pw@localhost:55432/yen pnpm --filter @yen/db migrate
```

The CLI runs TypeScript directly on Node 24, so it needs no prior build. For programmatic use, call `await migrate(sql)` or `await migrate(sql, { dir: absoluteDirectory })` with a client from `createSql()`.

`DATABASE_URL` and `YEN_TEST_DATABASE_URL` accept `postgres://` and `postgresql://` URLs with a nonempty host. Credentials, ports, database paths, query parameters, IPv6 hosts, and valid percent escapes are supported. Whitespace and malformed percent escapes are rejected. Invalid settings fail validation before client construction, and validation errors name the variable without including its value.

Files use `migrations/NNNN_name.sql`, starting at `0001` with no gaps or duplicate versions. Names use lowercase letters, digits, and underscores. The runner sorts by version and records the full filename, version, SHA-256 of the file bytes, and `applied_at` in `schema_migrations`.

One session advisory lock covers history validation and all migrations. Each pending file and its history row commit in a single transaction. A failure rolls back that file and releases the lock; earlier files stay committed. Before applying any migration, the runner rejects top-level transaction-control statements in every file, including `BEGIN`, `COMMIT`, and `ROLLBACK`. Transaction words inside comments, strings, and dollar-quoted bodies are not top-level statements. `CREATE INDEX CONCURRENTLY` and other non-transactional statements are still unsupported.

The runner forces `standard_conforming_strings = on` and forbids migrations from changing it. A `set_config` call is allowed only when its first argument is one ordinary or `E''` string literal naming another setting. Dynamic setting names are rejected.

The preflight deliberately rejects a few valid SQL forms: an ordinary string ending in a backslash before its closing quote (for example `SELECT '\';`) is rejected even though PostgreSQL accepts it with `standard_conforming_strings = on`, so the lexer and server cannot disagree if the session setting changes. Write such strings with `E''` escapes. Any use of the identifier `standard_conforming_strings`, even as a table or column name, is also rejected; rename that identifier.

Applied files are immutable. An edited checksum, missing file, renamed file, version gap, duplicate version, or out-of-order history fails the run. A second run leaves application data and migration history unchanged. There are no down migrations. Run the runner through a direct Postgres connection or session-pooling proxy because transaction-pooling proxies cannot preserve its session advisory lock.

## Run database tests locally

Start Postgres 16 with Podman, or replace `podman` with `docker`:

```sh
podman run -d --name yen-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 docker.io/library/postgres:16
```

If `konto-pg-probe` is already running on port 55432 with these credentials, reuse it. Set the admin connection and run tests from the workspace root:

```sh
YEN_TEST_DATABASE_URL=postgres://postgres:pw@localhost:55432/postgres pnpm verify
```

`YEN_TEST_DATABASE_URL` must permit `CREATE DATABASE` and `DROP DATABASE`. Each database test file creates a unique `yen_test_<random UUID>` database and drops it after the suite, including failed tests. Test DDL and migrations run only inside those throwaway databases. The admin database is used only to create and drop them. An interrupted process can leave its throwaway database behind.

Without this variable, database suites skip with a message when `CI` is unset, `false`, or `0`. `CI=true` and `CI=1` make a missing variable a hard failure. These CI values are case-sensitive; other values, including an empty string, are rejected. An explicitly empty or invalid test URL fails in both local and CI modes. `packages/db/turbo.json` passes the variable and `CI` through Turbo's environment filter and disables test caching so database checks always execute.

## Prior art

- [PostgreSQL constraints](../../docs/REFERENCES.md#pg-constraints) explain database enforcement and uniqueness.
- [PostgreSQL EXPLAIN](../../docs/REFERENCES.md#pg-explain) describes query plans and the effects of ANALYZE.
- [PostgreSQL lexical structure](../../docs/REFERENCES.md#pg-lexical) informs migration preflight; the scanner is not a complete SQL parser.
- [PostgreSQL string compatibility](../../docs/REFERENCES.md#pg-strings) explains why string interpretation depends on server settings.
- [Square Money](../../docs/REFERENCES.md#square-money) uses integer minor units; Yen stores paise as bigint and checks range at number boundaries.
- [DPDP Act](../../docs/REFERENCES.md#dpdp-act) provides context for limiting personal data; an erasable mapping alone does not prove compliance.
