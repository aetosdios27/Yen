# @yen/db

Postgres.js client, application row schemas, migration runner, and the fund event log persistence layer (YEN-21).

## Scope and decisions

**Decision.** Use plain SQL and forward-only migrations. Generate UUIDv7 primary keys in the application with `uuidv7()`; UUID columns have no defaults. Use `timestamptz` for instants and UTC sessions. Store money as `bigint` paise with nonnegative CHECK constraints. Use CHECKed text for membership roles, statuses, and fund visibility so later SQL migrations can change the allowed values without managing Postgres enum types. `legal_form` remains unconstrained text until the domain defines its allowed values.

**Consequences.** SQL is the source of truth. Schema changes require a new migration and matching row-schema changes. Each migration must fit in one transaction. Deployments cannot roll back the schema; corrections require another forward migration. No ORM or query-builder layer sits between callers and Postgres.

PII belongs only in application tables. `pseudonyms` is an erasable mapping from a public UUID to a user. Historical records store the UUID value without a foreign key to this mapping. They must never cascade from the mapping: deleting it must preserve the historical record. All app foreign keys use the default restrictive delete behavior.

The five fund roles are `owner`, `treasurer`, `approver`, `auditor`, and `member`. Multiple roles per user and fund are valid. Membership status is explicit on insert. Idempotency keys are globally unique and store a required request hash and completed JSON response; the API owns request hashing, concurrency, replay, and retention.

## Use typed rows

`createSql(url, options)` returns a postgres.js client with configurable pool settings:
- `max`: maximum connection pool size (default: 10 connections).
- `idleTimeout`: idle connection timeout in seconds before reaping (default: 20 seconds).
- `connectTimeout`: connection acquisition timeout in seconds (default: 10 seconds).
- `prepare`: boolean to enable or disable named prepared statements (default: `true`).

Close the client with `await sql.end({ timeout })`.

### PgBouncer compatibility and pooling caveats

- **Session state**: Connections are established with startup parameters (`TimeZone: "UTC"`) to avoid runtime `SET` commands that leak across pooled transactions.
- **Advisory locks**: In PgBouncer transaction mode, connections are recycled across transactions. Session-level advisory locks (`pg_advisory_lock` / `pg_advisory_unlock`) are unsafe in transaction mode because release calls can hit a different backend connection. Transaction-scoped advisory locks (`pg_advisory_xact_lock`) must be used for transaction-level synchronization (such as event log appends); they release automatically on commit or rollback. Migration runs require a session advisory lock and therefore must run against direct Postgres or session pooling.
- **Prepared statements**: Named prepared statements are tied to backend connection state. In PgBouncer transaction mode without `max_prepared_statements` (PgBouncer 1.21.0+), named prepared statements cause collisions or cache errors across clients. Pass `prepare: false` to `createSql` when using transaction pooling without named prepared statement support.

Parse query results with the exported `userRowSchema`, `orgRowSchema`, `fundRowSchema`, `membershipRowSchema`, `pseudonymRowSchema`, `idempotencyKeyRowSchema`, `fundEventRowSchema`, or `rateLimitRowSchema`. Each schema has a corresponding inferred `*Row` type. ID parsing uses `@yen/shared`'s branded `UserId`, `OrgId`, and `FundId` parsers.

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

## Fund event log persistence

The `fund_events` table stores the hash-chained business events for each fund, defined by migration `0003_fund_events.sql`:
- `fund_id uuid NOT NULL REFERENCES funds(id)`
- `seq bigint NOT NULL CHECK (seq >= 1)`
- `type text NOT NULL`
- `version integer NOT NULL CHECK (version = 1)`
- `actor text NOT NULL CHECK (actor ~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`
- `occurred_at text NOT NULL CHECK (occurred_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')`
- `payload jsonb NOT NULL`
- `prev_hash text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$')`
- `hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$')`
- `canonical_envelope text NOT NULL`
- `PRIMARY KEY (fund_id, seq)`

### Database-enforced integrity

Integrity is enforced in PostgreSQL triggers and functions:
1. **Advisory lock and gapless sequence**: A BEFORE INSERT trigger takes a per-fund advisory lock (`pg_advisory_xact_lock` on the fund ID) for the duration of the transaction. It requires `seq` = 1 and `prev_hash` = 64 zeroes for the first event, and `seq = previous + 1` and `prev_hash = previous hash` for subsequent events.
2. **Monotonic time**: The insert trigger requires `occurred_at >= previous occurred_at`.
3. **Payload schema enforcement**: The insert trigger independently validates `payload` against the 24 event schemas. Payloads must contain only allowed keys and supported types (strings, safe integers).
4. **RFC 8785 canonical envelope & SHA-256 verification**: The insert trigger reconstructs the RFC 8785 canonical JSON envelope using custom PL/pgSQL routines implementing UTF-16 code unit key sorting and ECMAScript number formatting, proves it matches `canonical_envelope`, and computes SHA-256 over `'yen/eventlog/event/v1' || E'\x00' || utf8(canonical_envelope)` using PostgreSQL 16's built-in `sha256(bytea)` function. Any row with a mismatched hash is rejected.
5. **Immutability**: BEFORE UPDATE, DELETE, and TRUNCATE triggers always raise exceptions. Furthermore, UPDATE, DELETE, and TRUNCATE are revoked from PUBLIC (expected application role: `yen_app`).

### TypeScript write path

`appendEvent(client, input)` is the only write path. Inside the transaction, it locks the fund, reads the current head, constructs the event with `makeNextEvent` from `@yen/eventlog`, inserts the complete row, and returns the stored event:

```ts
import { appendEvent, createSql } from "@yen/db";

const sql = createSql(databaseUrl);
const event = await appendEvent(sql, {
  fundId,
  type: "fund.created",
  version: 1,
  actor,
  occurredAt: "2026-01-01T00:00:00.000Z",
  payload: { org_id: orgId, visibility: "private" },
});
```

### Verification and CLI

Verify a stored chain against a caller-supplied authenticated `ChainHead`:

```ts
import { createSql, verifyStoredChain } from "@yen/db";

const sql = createSql(databaseUrl);
const verification = await verifyStoredChain(sql, fundId, expectedHead);
if (verification.ok) {
  console.log(`Verified up to event ${verification.count}`);
}
```

The workspace CLI checks fund event chains:

```sh
DATABASE_URL=postgres://postgres:pw@localhost:55432/yen pnpm --filter @yen/db verify-chain <fund-id> [--head <hash> --count <count>]
```

The CLI prints the first break (index, seq, reason) or the verified head. Note: the CLI is an internal consistency check, not an external authenticity proof.

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

The preflight deliberately rejects a few valid SQL forms: an ordinary string ending in a backslash before its closing quote (for example `SELECT '\\';`) is rejected even though PostgreSQL accepts it with `standard_conforming_strings = on`, so the lexer and server cannot disagree if the session setting changes. Write such strings with `E''` escapes. Any use of the identifier `standard_conforming_strings`, even as a table or column name, is also rejected; rename that identifier.

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

## Waitlist data and deletion

`waitlist_entries` stores the submitted name, normalized contact and kind, club
name, locale, consent text and version, a generated UUID, and creation time.
The unique normalized contact prevents duplicate entries. For a deletion request,
identify and normalize the contact as at signup, then use the helper with an
operator-controlled connection; it returns the number of rows deleted:

```ts
import { createSql, deleteWaitlistEntryByContact } from "@yen/db";

const sql = createSql(databaseUrl);
try {
  const removed = await deleteWaitlistEntryByContact(sql, normalizedContact);
} finally {
  await sql.end();
}
```

Backups and any other copies also need an operational deletion and retention policy.
