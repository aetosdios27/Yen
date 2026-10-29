# Yen API foundation

`openapi/openapi.json` is the committed OpenAPI 3.1 contract for YEN-15.
Route definitions in `src/contract.ts` own request and response schemas.
`@yen/api-client` generates its types from this file.

## Routes

| Method | Path                     | Behavior                                          |
| ------ | ------------------------ | ------------------------------------------------- |
| GET    | `/health`                | Public liveness                                   |
| GET    | `/ready`                 | Public readiness, through an injected async check |
| GET    | `/v1/openapi.json`       | Public OpenAPI document                           |
| GET    | `/v1/me`                 | Current principal                                 |
| POST   | `/v1/auth/device/unlock` | Unlock an OTP-proven session with the Yen PIN     |
| POST   | `/v1/auth/device/lock`   | End the current trusted-device unlock period      |
| GET    | `/v1/auth/sessions`      | List active trusted devices                       |
| POST   | `/v1/funds`              | Stub: create an in-memory fake fund               |
| GET    | `/v1/funds/{fundId}`     | Stub: read a fake fund owned by the principal     |

## Sign-in policy (YEN-72)

Phone OTP proves control of the phone number. The user chooses WhatsApp or SMS
for each challenge; delivery does not silently switch channels. OTP is required
for first sign-in, adding a device, account recovery, and PIN reset. It is not a
factor for each ordinary session.

An OTP-proven session on an existing device unlocks with the 6-digit Yen PIN.
Device unlock and approval checks use the same `PinService` credential
verification, so both update the existing lockout state. Unlock failures return
a generic unauthenticated error and do not reveal whether a phone number has
an account. The PIN verifier uses an HMAC key held outside Postgres; PIN values
must not appear in logs, URLs, or analytics.

An OTP-authenticated session becomes a trusted device only after successful
PIN setup or verification. Trusted-device state is bound to its session, shown
in the authenticated session/device list, and revoked by sign-out or
sign-out-everywhere. The policy sets a 7-day idle timeout and a 30-day
absolute lifetime. After idle expiry, PIN reauthentication is required while
the session remains within its absolute lifetime. OTP is required again after
absolute expiry, on a new device, and for recovery or PIN reset. A
device-bound fingerprint/biometric authenticator is out of scope; YEN-71 owns
that extension. It should be a device-local activation factor and must not
send biometric data to Yen.

The `trusted_devices` table stores session and user identifiers, timestamps,
and revocation state only. Session tokens remain hashed in `sessions`; the PIN
and biometric secrets are not stored in the trusted-device record.

These are Yen product decisions, not a claim of NIST conformance. NIST SP
800-63B-4 distinguishes centrally verified memorized secrets from local device
activation secrets, requires throttling for password verifiers, describes
authenticator binding records, and calls for documented inactivity and overall
session timeouts. Yen's PIN is centrally verified and is protected by the
shared lockout counter. See [NIST SP 800-63B-4](../../docs/REFERENCES.md#nist-800-63b).

The device unlock endpoint is method-shaped so YEN-71 can add a device-bound
biometric verifier without changing session or device-list semantics. The API
does not receive or store fingerprint data.

Fund data disappears on restart. A fund starts with `name` and `targetPaise`.
The response adds a canonical lowercase UUID `id` and an ISO timestamp `createdAt`.
Invalid or missing FundIds return `404`, using `@yen/shared`'s branded parser.
`createApp` defaults to a deny-all `Policy`. Every fund handler calls `can(principal,
action, resource)` before accessing or changing fund data and sends only the result
of `redact(viewer, resource)`. Inject `devPolicy` explicitly in tests and `dev:mock`;
it permits creation and owner reads. Denied creates return `403 forbidden`. Denied
reads return `404 not_found` so a caller cannot learn whether a fund exists.
YEN-26 will supply the real role and approval checks; YEN-31 will supply public
visibility and redaction rules. Until then, production needs an explicit policy.
All authenticated routes reject requests until a principal is explicitly injected.
The bearer security scheme reserves the contract for YEN-22; it does not authenticate tokens today.

## Evidence uploads

Uploads are scanned with ClamAV using the daemon's TCP INSTREAM protocol when `CLAMAV_HOST` is configured. Production startup requires this setting; local development keeps the fail-closed unconfigured scanner unless explicitly configured. Files ClamAV identifies as infected, files above its configured limit, and scans that fail or time out are rejected before bytes are stored or an evidence event is appended. Accepted evidence records include the scanner name and ClamAV signature database version. These fields stay out of the canonical event payload.

For local testing, start a daemon with `podman run --rm --name yen-clamd -p 3310:3310 clamav/clamav:stable` and set `CLAMAV_HOST=127.0.0.1` (defaults: port `3310`, timeout `10000` ms, maximum scan size `10485760` bytes). Staging should run ClamAV as a private service reachable only by the API and set `CLAMAV_HOST` to its internal hostname. Do not expose clamd publicly. The `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`, and `CLAMAV_MAX_SIZE_BYTES` variables are validated at startup.

## Wire money

Every money field is a **canonical nonnegative decimal string of integer paise**.
`"0"` and `"9007199254740993"` are valid. JSON numbers, signs, leading zeroes,
fractions, whitespace, and exponential notation are invalid.
`@yen/shared` exports the single `paiseWire` schema used by the routes.

Use `BigInt(value)` for arithmetic. Do not pass large wire values through `Number`
or the existing safe-number `Paise` helpers. This wire contract does not change
those helpers or impose a product-level maximum. Signed ledger amounts need a
separate schema if introduced later.

## Errors and request IDs

Every error has this shape:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Request validation failed",
    "requestId": "00000000-0000-4000-8000-000000000001",
    "details": [{ "path": ["json", "targetPaise"], "message": "Invalid input" }]
  }
}
```

`details` is optional and contains validation field paths, prefixed with the input
location. Malformed JSON has the same envelope without field details.
Unknown exceptions return the fixed internal error message, with no stack or cause.

| Code                   | Status |
| ---------------------- | ------ |
| `validation_failed`    | 400    |
| `unauthenticated`      | 401    |
| `forbidden`            | 403    |
| `not_found`            | 404    |
| `conflict`             | 409    |
| `idempotency_conflict` | 409    |
| `rate_limited`         | 429    |
| `payload_too_large`    | 413    |
| `overloaded`           | 503    |
| `internal`             | 500    |

`src/errors.ts` owns the closed error-code schema and status table.
Every response carries `x-request-id`. A UUID-shaped inbound ID with a valid
version and variant is accepted; otherwise the server generates one.
Readiness defaults to success. Inject `readiness: async () => boolean` to check
dependencies; false or a thrown exception returns `internal` (503 for readiness).

## Idempotency storage contract

Authenticated unsafe `/v1` requests require `Idempotency-Key` after authentication.
Keys contain 1 to 128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, and `-`.
The store key is the JSON tuple `[principal.id, headerValue]`.
The SHA-256 request hash binds the method, path and query, content type, and exact body bytes.
Different JSON whitespace therefore conflicts.

`IdempotencyStore.begin` must atomically reserve an absent key before returning `new`.
An existing reservation returns `in_progress`; completed entries return `complete`
with their original hash and full response. Changed input or a concurrent duplicate
returns `409 idempotency_conflict`. An in-progress response also has `retry-after: 1`.

Reservations are 30-second leases by default. After expiry, `begin` can replace a
reservation and issue a new fencing token. `complete` and `release` accept that token;
an abandoned attempt cannot overwrite or release its replacement. A handler exception,
response persistence failure, or response with status 500 or higher releases the key.
Only completed responses below 500 replay with `idempotent-replayed: true`.

`complete` stores status, all response headers, and a base64 body (`null` for a response with no body). The response body
is identical, including an original error's requestId; `x-request-id` identifies the
current HTTP request. Replays consume rate-limit tokens.

The interface maps to an `idempotency_keys` row with `key`, `request_hash`, `token`,
`lease_expires_at`, `response jsonb`, `replay_expires_at`, and `created_at`.
`response = null` represents an in-progress reservation. `begin` needs an atomic
insert or expired-lease takeover; completion and release must compare the token and
hash. `createdAt` is epoch milliseconds. YEN-18/24 owns the Postgres adapter and
schema; this contract does not change that migration.

Completed idempotency responses are retained for 24 hours by default (`replayRetentionMs = 86_400_000`),
after which the key expires and can be reused. In-progress reservations have a 30-second lease
(`inProgressTtlMs = 30_000`), after which an abandoned lease can be taken over atomically by another
request with a new fencing token. Both in-memory (`MemoryIdempotencyStore`) and PostgreSQL
(`PostgresIdempotencyStore`) stores implement this retention policy.

In PostgreSQL, `PostgresIdempotencyStore` operates on the `idempotency_keys` table. `begin`
atomically inserts absent keys or takes over expired leases using `INSERT ... ON CONFLICT (key) DO UPDATE`
returning whether the token was newly acquired. `complete` and `release` check the fencing token and
request hash so stale or replaced workers cannot overwrite or release an active lease. `sweep()`
purges expired completed entries and abandoned leases without lock contention using `FOR UPDATE SKIP LOCKED`.
Migration `0004` backfills `replay_expires_at` as `created_at + 24 hours` for existing completed rows, so they expire like new ones.
In PostgreSQL mode the process calls `sweep()` and the rate-limit `prune()` on the schedule described under "Retention" below.

## Phone OTP and sessions

`POST /v1/auth/otp/send` requires a selected `channel` (`whatsapp` or `sms`). Delivery
must use that channel exactly; failures do not fall back to the other provider. Only
one active code is kept for a phone number. Verification attempts are counted per
phone across channel changes in a five-minute window (or the configured OTP expiry).
OTP hashes use the server-side `OTP_HASH_KEY`, which must be at least 32 characters
in production. Losing or rotating the key invalidates outstanding codes. Session
tokens are random opaque values; storage keeps only their SHA-256 hashes, and rotation
preserves the original absolute expiry. The production entrypoint fails closed while
no concrete WhatsApp/SMS adapter is configured; the in-memory delivery stub is limited
to development and tests.

## Rate limits and logs

Both token buckets apply to `/v1` requests. The default per-IP capacity is 120;
the per-principal capacity is 60. Both refill continuously over 60 seconds.
Configure positive integer `RATE_LIMIT_IP_CAPACITY`, `RATE_LIMIT_PRINCIPAL_CAPACITY`,
and `RATE_LIMIT_REFILL_MS` at startup. A rejected request returns `429` with integer
seconds in `retry-after`. Liveness and readiness bypass rate limits.

The Node entrypoint resolves the socket peer address and ignores forwarded headers
unless `TRUSTED_PROXY_HOPS` is set (see the proxy paragraph below).
Store instances are injectable. When `DATABASE_URL` is provided, production uses `PostgresRateLimitStore`
on the `rate_limits` table so limits hold across multiple API instances and processes. Each key takes a
transaction-level advisory lock, `pg_advisory_xact_lock(0x59454e01, hashtext(key))`. A key that is new or
whose window has expired also takes one global admission lock, `pg_advisory_xact_lock(0x59454e02, 0)`,
and rechecks the `RATE_LIMIT_MAX_KEYS` capacity under it, so concurrent first-time keys cannot exceed the cap.
Both locks use the two-`int4` form, which PostgreSQL keeps separate from the one-`bigint` form used by fund
events (`yen_fund_lock_key`). Atomic upserts coordinate continuous token refill and fixed-window expiry.
A delayed request never moves a bucket's timestamp backwards, so it cannot refill tokens twice.
In-memory mode (`MemoryRateLimitStore`) is used when `YEN_ALLOW_MEMORY_STORES=true` or in local mock mode.

### Retention

`CLEANUP_INTERVAL_MS` (default `60000`, range `1000`–`3600000`) sets how often PostgreSQL mode runs
`sweep()` on `idempotency_keys` and `prune()` on `rate_limits`. Each call removes at most 1000 expired rows.
Ticks never overlap. A failed call writes one stderr line, `{"event":"cleanup_failed","task":"...","errorName":"..."}`,
with no message or stack, and the next tick retries. On `SIGINT` or `SIGTERM` the process stops the scheduler,
closes the HTTP server, and ends the database pool.

Request logs contain only event, UUID requestId, method, route template, status, and
durationMs. Failure logs contain only event, requestId, method, route template,
`errorKind` (`readiness`, `store`, `handler`, `validation`, or `unknown`), and the
error constructor name. The JSON serializer strips unknown fields. We omit error
messages and stacks because store exceptions and validation messages can contain
input or secrets. No raw URL, query, body, header, principal, phone number,
authorization, cookie, or idempotency key is logged.

## ADR: keep Hono

Status: accepted for YEN-15.

We considered Hono and Fastify. Hono remains the HTTP framework because it is small,
runtime-portable, and already present in the scaffold. `@hono/zod-openapi` provides
first-class Zod 4 validation and OpenAPI 3.1 generation from the route definitions.
`app.request` exercises the stack without binding a socket.

Fastify offers an established Node plugin ecosystem, but switching would add a migration
without improving this contract. Runtime-specific peer address lookup and server startup
stay in the Node entrypoints. `createApp(deps)` accepts the clock, ID generator, stores,
logger, principal, readiness check, and peer address resolver.

## Waitlist

`POST /v1/waitlist` is public and write-only. Send `name`, `contact`, `org`,
`locale` (`en` or `hi`), and `consent` containing `accepted: true`, `text`,
and `version`. A new or duplicate contact receives the same `201` response.
Email is lowercased. Canonical E.164 numbers are accepted; as a product decision,
Indian 10-digit mobile numbers with optional spaces or dashes default to `+91`.

The database stores a UUID, name, normalized contact and kind, organization,
locale, exact trimmed consent text and version, and creation time. It does not
store IP addresses, request bodies, or a separate acceptance flag. No waitlist
read or export endpoint exists. The real server requires `DATABASE_URL` unless `YEN_ALLOW_MEMORY_STORES=true` is explicitly set outside production. With that opt-in, waitlist data is held in memory and lost on restart. `dev:mock` uses memory automatically and is disabled in production. Database
location must be configured by the operator; the application does not enforce India.

The default limit is five requests per IP per fixed hour per process, configured
with `WAITLIST_RATE_LIMIT_CAPACITY` and `WAITLIST_RATE_LIMIT_REFILL_MS`. The
body limit defaults to 8192 bytes and is configured by `WAITLIST_BODY_LIMIT_BYTES`.
A shared rate-limit store and trusted proxy configuration are needed for a
multi-process or proxied deployment. Contact uniqueness provides retry safety;
the public route does not require an idempotency key.

The waitlist response floor (`WAITLIST_MIN_RESPONSE_MS`, default 75 ms) hides differences below the floor. The per-IP limit of five requests per hour makes statistical timing attacks impractical; a slow database could still exceed the floor.

`TRUSTED_PROXY_HOPS` defaults to 0 and ignores all forwarded headers (safe by default). Set it to the number of trusted proxy hops (1–5) only when the server is reachable exclusively through those proxies.
`TRUSTED_PROXY_HEADER` names the one header that is read when hops are configured: `x-forwarded-for` (the default) or `forwarded` (RFC 7239, `for=` parameter). Choose the header your edge proxy overwrites. The other header is never read, so a client cannot pick its rate-limit address by sending the unused one. The address is selected from the right of that header by hop count. Quoted strings are parsed per RFC 7230, so commas and semicolons inside quotes do not split elements. `unknown`, obfuscated `_name` identifiers, and non-IP values fall back to the socket address. Spoofed headers cannot evade or poison limits when no trusted proxy is configured. Shared rate limiting across processes is implemented via `PostgresRateLimitStore` (YEN-55).

The `RATE_LIMIT_MAX_KEYS` setting (1,000–1,000,000, default 100,000) is a deliberate
global admission limit that protects process memory. When active fixed windows fill
the store, new keys receive 503 with `Retry-After`; existing keys remain enforced.
Each key retains its string and a bucket with three numbers, plus Map
and JavaScript object overhead; memory varies with key length and runtime (budget
roughly hundreds of bytes per key). A shared store is the long-term fix (YEN-55).

Readiness uses a dedicated database connection, a two-second deadline and a
server-side statement timeout. `READINESS_CACHE_MS` controls result caching
(default 1,000 ms, range 0–60,000; 0 disables caching). Concurrent probes share
one check.

## API Runtime Hardening (YEN-56)

### Stateless Process Audit and Known Exceptions

The API server process is strictly stateless; nothing required to survive a restart or maintain correctness across instances lives in process memory. The following are known exceptions:
1. **Idempotency store (`MemoryIdempotencyStore`)**: Process-memory store by default; being migrated to Postgres in YEN-55.
2. **Rate limit store (`MemoryRateLimitStore`)**: Process-memory store by default; being migrated to Postgres in YEN-55.
3. **Funds resource (`funds` Map)**: In-memory foundation stub from YEN-15; domain persistence in Postgres in YEN-26/31.
4. **Waitlist memory store (`MemoryWaitlistStore`)**: Permitted only in development when `YEN_ALLOW_MEMORY_STORES=true` is explicitly set; forbidden in production.

### Postgres Connection Pool and PgBouncer Settings

Database connection pool parameters are validated in `env.ts` with explicit defaults:
- `DATABASE_POOL_MAX`: Maximum active connections (default `10`, range `1–1000`).
- `DATABASE_POOL_IDLE_TIMEOUT_SECONDS`: Idle connection reap timeout (default `20`, range `0–86400`).
- `DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS`: Connection acquisition timeout (default `10`, range `1–300`).

PgBouncer transaction-mode considerations:
- Startup parameters enforce UTC sessions without runtime `SET` leaks.
- Named prepared statements are disabled by passing `prepare: false` to `createSql` when connecting through PgBouncer without `max_prepared_statements` enabled.
- Locks: Transaction-scoped advisory locks (`pg_advisory_xact_lock`) are safe in transaction pooling mode; session-scoped advisory locks are not.

### HTTP Limits, Timeouts, and Slow-Client Protection

Node HTTP server settings tuned to mitigate slow-client attacks (Slowloris):
- `SERVER_HEADERS_TIMEOUT_MS`: Time allowed to receive complete request headers (default `20000` ms, range `1000–300000`, must exceed `SERVER_KEEP_ALIVE_TIMEOUT_MS`).
- `SERVER_REQUEST_TIMEOUT_MS`: Maximum duration for entire HTTP request receipt (default `15000` ms, range `1000–600000`).
- `SERVER_KEEP_ALIVE_TIMEOUT_MS`: Inactivity timeout before closing idle keep-alive sockets (default `5000` ms, range `0–60000`).
- `SERVER_MAX_HEADER_SIZE_BYTES`: Maximum HTTP request header size (default `16384` bytes / 16 KiB, range `1024–1048576`).
- Request body limits: 64 KiB default body limit on `/v1/*` routes; configurable `WAITLIST_BODY_LIMIT_BYTES` (default 8,192 bytes) for waitlist.
- Per-request execution timeout: `REQUEST_TIMEOUT_MS` (default `15000` ms, range `100–300000`). A request that runs longer receives `504 Gateway Timeout` with error code `gateway_timeout`. A timed-out handler is not cancelled: it keeps running until it settles, and it keeps its in-flight slot until then, so graceful shutdown waits for it instead of closing the database pool underneath it. Because the handler can still commit after the client received `504`, handlers that write must be idempotent; clients retry writes with the same `Idempotency-Key`.

### Backpressure and Load Shedding

- `CONCURRENCY_LIMIT`: Maximum concurrent in-flight requests (default `100`, range `1–10000`).
- When the limit is reached, incoming requests immediately receive HTTP `503 Service Unavailable` with `Retry-After: 1` header before memory or event loop saturation occurs. Rejected requests never take an in-flight slot, so a burst of rejections does not keep the service rejecting once admitted work completes. Each rejection is logged as a warning with reason `overloaded` and the in-flight count.
- `/health` and `/ready` are neither counted nor limited, so probes stay responsive during overload and never take capacity from ordinary requests.
- `503` and `504` responses carry the same CORS headers as other responses, and `Retry-After` is exposed to browsers.

### Graceful Shutdown Lifecycle

Lifecycle management is handled by `createServerLifecycle` in `lifecycle.ts`:
- Listens for `SIGTERM` and `SIGINT`.
- Sets the shutdown flag immediately: `/ready` returns `503` from that moment, while `/health` stays `200`.
- Closes the HTTP server (`server.close()`) to refuse new incoming connections.
- Closes existing idle sockets (`server.closeIdleConnections()`).
- Drains active in-flight requests with polling, bounded by `SHUTDOWN_TIMEOUT_MS` (default `10000` ms).
- Force-closes remaining sockets (`server.closeAllConnections()`) if the shutdown deadline expires.
- Closes the Postgres pool (`sql.end({ timeout })`) with bounded timeout.
- Exits with code 0 when cleanup succeeded. If closing the pool fails, writes one line to stderr (`Error during <signal> shutdown: Database pool failed to close`) and exits with code 1. The error details are not printed.

## Prior art

- [AWS idempotent APIs](../../docs/REFERENCES.md#aws-idempotency) explain atomic coordination of a request identifier and mutations, which the current store does not provide.
- [RFC 9457](../../docs/REFERENCES.md#rfc-9457) describes machine-readable errors; Yen uses a different envelope.
- [RFC 6585](../../docs/REFERENCES.md#rfc-6585) defines 429 and describes Retry-After.
- [Stripe idempotency](../../docs/REFERENCES.md#stripe-idempotency) motivates safe retries; Yen scopes keys to principals and hashes exact request bytes, and its in-memory store is not durable.
- [Stripe rate limiters](../../docs/REFERENCES.md#stripe-rate-limiters) describes token buckets; Yen’s default buckets are per process.
- [Square Money](../../docs/REFERENCES.md#square-money) uses minor units; Yen encodes paise as decimal strings to preserve large integers.
- [WebAuthn Level 2](../../docs/REFERENCES.md#webauthn-2) is relevant to planned authentication, which the current bearer contract does not implement.
