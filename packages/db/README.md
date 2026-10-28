# @yen/db

Postgres.js client, application row schemas, migration runner, and the fund event log persistence layer (YEN-21).

## Scope and decisions

**Decision.** Use plain SQL and forward-only migrations. Generate UUIDv7 primary keys in the application with `uuidv7()`; UUID columns have no defaults. Use `timestamptz` for instants and UTC sessions. Store money as `bigint` paise with nonnegative CHECK constraints. Use CHECKed text for membership roles, statuses, and fund visibility so later SQL migrations can change the allowed values without managing Postgres enum types. `legal_form` remains unconstrained text until the domain defines its allowed values.

**Consequences.** SQL is the source of truth. Schema changes require a new migration and matching row-schema changes. Each migration must fit in one transaction. Deployments cannot roll back the schema; corrections require another forward migration. No ORM or query-builder layer sits between callers and Postgres.

PII belongs only in application tables. `pseudonyms` is an erasable mapping from a public UUID to a user. Historical records store the UUID value without a foreign key to this mapping. They must never cascade from the mapping: deleting it must preserve the historical record. All app foreign keys use the default restrictive delete behavior.

The five fund roles are `owner`, `treasurer`, `approver`, `auditor`, and `member`. Multiple roles per user and fund are valid. Membership status is explicit on insert. Idempotency keys are globally unique and store a required request hash and completed JSON response; the API owns request hashing, concurrency, replay, and retention.

## Use typed rows

`createSql(url)` returns a postgres.js client with at most 10 connections, prepared statements, a 10-second connection timeout, a 20-second idle timeout, quiet notices, and UTC sessions. Close the client with `await sql.end()`.

Parse query results with the exported `userRowSchema`, `orgRowSchema`, `fundRowSchema`, `membershipRowSchema`, `pseudonymRowSchema`, `idempotencyKeyRowSchema`, or `fundEventRowSchema`. Each schema has a corresponding inferred `*Row` type. ID parsing uses `@yen/shared`'s branded `UserId`, `OrgId`, and `FundId` parsers.

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

The CLI prints the first break (index, seq, reason) or the verified head. It runs directly on Node 24 and recomputes event hashes; without an independently authenticated head it checks internal consistency, not authenticity. Both `--head` and `--count` must be supplied together.

Use a non-superuser application role without database `TEMP` privilege. Since PostgreSQL grants `TEMP` to `PUBLIC` by default, revoke that database privilege from `PUBLIC` and grant it only to roles that need it. The migration does not change database-level privileges; its trigger functions also pin their search path and read the public event table explicitly.

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

## Query-plan discipline and hot-path registry

All hot-path database queries in Yen (fund reads, membership lookups, event append, donation and expense lists) are registered in a single central registry in [`src/query-registry.ts`](src/query-registry.ts).

### Contract for future feature PRs

Every future pull request that introduces or modifies a hot-path database query must adhere to the following contract:
1. **Register the query**: Add an entry to `INITIAL_HOT_PATH_QUERIES` in [`src/query-registry.ts`](src/query-registry.ts) or call `registerHotPathQuery()`.
   - Specify `id`, `name`, `category` (`fund_reads`, `membership_lookups`, `event_append`, `donation_lists`, `expense_lists`, etc.).
   - Define `sqlTemplate` and `explain` function using tagged template literals (`sql\`EXPLAIN (FORMAT JSON) ...\``).
   - Set `expectedPlan`:
     - `targetTable`: relation name.
     - `expectedIndex`: the specific B-tree index expected to serve the lookup (e.g. `funds_pkey`, `funds_org_id_idx`).
     - `disallowSeqScan: true`: forbids sequential scans on the target table.
     - `maxCost`: total estimated cost ceiling derived from `EXPLAIN (FORMAT JSON)` on realistic data.
2. **Automated CI enforcement**:
   - `packages/db/src/query-plan.test.ts` seeds a realistic dataset (>100k rows across tables, thousands of funds) and runs `ANALYZE`.
   - CI executes `EXPLAIN (FORMAT JSON)` on every registered query, asserting that no sequential scan occurs on any table over 100,000 rows and that estimated cost does not exceed `maxCost`.
   - If an index is dropped, unindexed columns are queried, or a plan regresses, the test suite immediately fails.

### Why estimated-cost budgets are used and their limits

- **Why used**:
  - **Deterministic CI evaluation**: As detailed in [PostgreSQL 16 Documentation: Using EXPLAIN](https://www.postgresql.org/docs/16/using-explain.html), the optimizer computes total estimated cost representing the disk page fetches and CPU operations required to execute a plan node to completion. Running `EXPLAIN (FORMAT JSON)` is instantaneous, side-effect free, and deterministic across CI runners, avoiding the false positives and flakiness of wall-clock benchmarking on shared CPU/IO runners.
  - **Plan regression guard**: Cost ceilings immediately detect when the planner abandons an index scan in favor of an expensive sequential scan, hash join, or unindexed nested loop.
- **Limits and caveats**:
  - **Synthetic metric, not wall-clock time**: Costs are expressed in arbitrary units of single page fetches (`seq_page_cost = 1.0`, `random_page_cost = 4.0`, `cpu_tuple_cost = 0.01`). They do not measure physical disk latency, OS page cache warmth, buffer pool locks, or network serialization to the client ([PostgreSQL 16 Caveats](https://www.postgresql.org/docs/16/using-explain.html#USING-EXPLAIN-CAVEATS)).
  - **Data volume dependency**: On toy-sized tables occupying only 1 or 2 pages, PostgreSQL almost always chooses a sequential scan regardless of indexes because reading 1 page sequentially is cheaper than reading an index page plus a heap page ([PostgreSQL 16 Caveats](https://www.postgresql.org/docs/16/using-explain.html#USING-EXPLAIN-CAVEATS)). Plan verification requires seeding realistic scale (100k+ rows) and running `ANALYZE` so `relpages` and `reltuples` reflect real production conditions.
  - **Statistical sampling variance**: `ANALYZE` gathers statistics via random sampling of table pages rather than exhaustive counts. Cost estimates can vary slightly between seed generations. Cost budgets must provide a 20–30% safety cushion above observed baseline costs rather than brittle exact equality checks.

## Foreign-key indexing discipline

In PostgreSQL, foreign key constraints (`REFERENCES`) enforce referential integrity but do **not** automatically create indexes on the referencing columns ([PostgreSQL 16 Foreign Keys](https://www.postgresql.org/docs/16/ddl-constraints.html#DDL-CONSTRAINTS-FK)). Without an index whose leading columns match the foreign key:
- Deletes or updates on the referenced parent table require full sequential scans on the referencing child table to verify referential integrity.
- Heavy row-level table locks during parent updates cause severe concurrency bottlenecks.

### Invariant and CI check

- **Rule**: Every foreign key must be supported by an index in the same migration that creates the table.
- **Verification**: CI runs `pnpm --filter @yen/db check:fk-indexes` against every migration from scratch.
  - The check inspects [`pg_constraint`](https://www.postgresql.org/docs/16/catalog-pg-constraint.html) (`contype = 'f'`) against [`pg_index`](https://www.postgresql.org/docs/16/catalog-pg-index.html) (`indrelid = conrelid`, `indisvalid = true`, `indpred IS NULL`).
  - Leading index columns (`indkey[1:cardinality(conkey)]`) must cover the foreign key constraint columns.
- **Allowlist policy**: If a foreign key is deliberately unindexed, it must be declared with an explicit technical justification in the allowlist in [`src/foreign-keys.ts`](src/foreign-keys.ts).

## Slow-query logging and privacy discipline (Staging & Production)

To maintain visibility into query performance without leaking sensitive personal data (names, phone numbers, UPI IDs, OTPs) to disk in PostgreSQL server logs, configure PostgreSQL 16 parameters according to the repository privacy rule: **Event payloads, Merkle leaves, logs, error reports, and on-chain data must not contain phone numbers, names, UPI IDs, bank account numbers, or OTPs.**

When query statement logging is enabled, PostgreSQL can record client bind parameter values (such as names and contact numbers passed to waitlist submissions or user lookups) unless explicitly suppressed. The following configuration disables parameter value logging while preserving query durations and statement diagnostics:

### 1. Bind parameter suppression (`log_parameter_max_length` & `log_parameter_max_length_on_error`)

By default, PostgreSQL allows bind parameter values to be logged in full (`-1`). To ensure sensitive query parameters never enter server logs:
- Set `log_parameter_max_length = 0` to completely disable logging of bind parameter values for non-error statement logs ([PostgreSQL 16 What to Log](https://www.postgresql.org/docs/16/runtime-config-logging.html#GUC-LOG-PARAMETER-MAX-LENGTH)).
- Set `log_parameter_max_length_on_error = 0` to disable logging of bind parameter values when statement errors occur ([PostgreSQL 16 What to Log](https://www.postgresql.org/docs/16/runtime-config-logging.html#GUC-LOG-PARAMETER-MAX-LENGTH-ON-ERROR)).

```ini
# Suppress all bind parameter values from statement and error logs
log_parameter_max_length = 0
log_parameter_max_length_on_error = 0
```

### 2. `log_min_duration_statement`

Logs the SQL statement text and elapsed wall-clock duration for any execution exceeding the configured threshold in milliseconds ([PostgreSQL 16 Error Reporting and Logging](https://www.postgresql.org/docs/16/runtime-config-logging.html#GUC-LOG-MIN-DURATION-STATEMENT)). Because bind parameters are suppressed via `log_parameter_max_length = 0`, only the query template and execution duration are recorded.
- **Staging**: `log_min_duration_statement = 250` (250ms) to detect slow or unindexed query patterns during integration testing and QA.
- **Production**: `log_min_duration_statement = 1000` (1000ms / 1s) to capture query regressions while avoiding excessive I/O log volume under high transactions per second.

### 3. `auto_explain` privacy policy

The `auto_explain` extension automatically logs query execution plans of slow statements directly to the PostgreSQL log ([PostgreSQL 16 auto_explain Documentation](https://www.postgresql.org/docs/16/auto-explain.html)).
- **Production Policy: Keep `auto_explain` disabled.** Execution plans and plan node filters can print literal parameter values and scan keys into log files, creating a personal data leak risk. In production environments, `pg_stat_statements` must be used instead.
- **Staging Policy: Enable only on scrubbed synthetic datasets.** If execution plan profiling is required during testing, `auto_explain` may only be enabled in environments running scrubbed or synthetic data:

  ```ini
  shared_preload_libraries = 'pg_stat_statements,auto_explain'
  auto_explain.log_min_duration = 250ms
  auto_explain.log_analyze = off        # Avoid per-node timing overhead
  auto_explain.log_buffers = on         # Shared buffer cache statistics
  auto_explain.log_timing = off
  auto_explain.log_nested_statements = on
  auto_explain.sample_rate = 1.0        # Explain 100% of slow statements on scrubbed staging
  ```

### 4. `pg_stat_statements` (Preferred Production Profiling)

The `pg_stat_statements` module tracks aggregate execution statistics across all query patterns ([PostgreSQL 16 pg_stat_statements Documentation](https://www.postgresql.org/docs/16/pgstatstatements.html)). Unlike raw plan logging, `pg_stat_statements` normalizes statements by replacing constant literals with query parameter symbols (`$1`, `$2`), inherently preventing personal data exposure while tracking execution counts, total times, mean times, and buffer statistics.
- Installation:

  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
  ```
- **Staging & Production Settings**:

  ```ini
  shared_preload_libraries = 'pg_stat_statements'
  pg_stat_statements.max = 10000        # Number of distinct query statements tracked (default 5000)
  pg_stat_statements.track = top        # Tracks all top-level statements submitted by clients
  pg_stat_statements.track_utility = on # Tracks DDL, ANALYZE, and VACUUM execution statistics
  pg_stat_statements.save = on          # Persists statistics across PostgreSQL server restarts
  ```
- **Operational Query**:
  Identify top queries consuming the most cumulative CPU/IO time:

  ```sql
  SELECT
    queryid,
    substring(query, 1, 80) AS short_query,
    calls,
    round(total_exec_time::numeric, 2) AS total_time_ms,
    round(mean_exec_time::numeric, 2) AS mean_time_ms,
    rows
  FROM pg_stat_statements
  ORDER BY total_exec_time DESC
  LIMIT 10;
  ```

## Prior art

- [PostgreSQL constraints](../../docs/REFERENCES.md#pg-constraints) explain database enforcement and uniqueness.
- [PostgreSQL EXPLAIN](../../docs/REFERENCES.md#pg-explain) describes query plans and the effects of ANALYZE.
- [PostgreSQL lexical structure](../../docs/REFERENCES.md#pg-lexical) informs migration preflight; the scanner is not a complete SQL parser.
- [PostgreSQL string compatibility](../../docs/REFERENCES.md#pg-strings) explains why string interpretation depends on server settings.
- [Square Money](../../docs/REFERENCES.md#square-money) uses integer minor units; Yen stores paise as bigint and checks range at number boundaries.
- [DPDP Act](../../docs/REFERENCES.md#dpdp-act) provides context for limiting personal data; an erasable mapping alone does not prove compliance.
