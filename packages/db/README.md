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
