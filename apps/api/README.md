# Yen API foundation

`openapi/openapi.json` is the committed OpenAPI 3.1 contract for YEN-15.
Route definitions in `src/contract.ts` own request and response schemas.
`@yen/api-client` generates its types from this file.

## Routes

| Method | Path                 | Behavior                                          |
| ------ | -------------------- | ------------------------------------------------- |
| GET    | `/health`            | Public liveness                                   |
| GET    | `/ready`             | Public readiness, through an injected async check |
| GET    | `/v1/openapi.json`   | Public OpenAPI document                           |
| GET    | `/v1/me`             | Current principal                                 |
| POST   | `/v1/funds`          | Stub: create an in-memory fake fund               |
| GET    | `/v1/funds/{fundId}` | Stub: read a fake fund owned by the principal     |

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
| `internal`             | 500    |

`src/errors.ts` owns the closed error-code schema and status table.
Every response carries `x-request-id`. A UUID-shaped inbound ID with a valid
version and variant is accepted; otherwise the server generates one.
Readiness defaults to success. Inject `readiness: async () => boolean` to check
dependencies; false or a thrown exception returns `internal`.

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

The in-memory store expires completed responses after 24 hours by default and sweeps
expired entries lazily on access. It caps entries at 10,000, evicting the oldest
completed responses first. When all slots hold active leases, it rejects a new
reservation until a lease expires; it never evicts an active lease to make room.
These defaults are injectable as `inProgressTtlMs`, `replayRetentionMs`, and
`maxEntries`. Production needs a shared store for consistent idempotency across
processes. A released or expired key can execute again, so operations with durable
side effects still need transactional coordination in that store.

## Rate limits and logs

Both token buckets apply to `/v1` requests. The default per-IP capacity is 120;
the per-principal capacity is 60. Both refill continuously over 60 seconds.
Configure positive integer `RATE_LIMIT_IP_CAPACITY`, `RATE_LIMIT_PRINCIPAL_CAPACITY`,
and `RATE_LIMIT_REFILL_MS` at startup. A rejected request returns `429` with integer
seconds in `retry-after`. Liveness and readiness bypass rate limits.

The Node entrypoint resolves the socket peer address. Forwarded headers are ignored.
Configure a trusted resolver explicitly when deploying behind a proxy.
Store instances are injectable and in-memory limits apply to one process. The
in-memory rate-limit store lazily removes buckets once they would be full and caps
entries at 10,000, evicting the oldest bucket when full. It has no background timer.
Production needs a shared rate-limit store for consistent limits across processes.

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
read or export endpoint exists. Production requires `DATABASE_URL`; without it
in other environments the waitlist is in memory and is lost on restart. Database
location must be configured by the operator; the application does not enforce India.

The default limit is five requests per IP per fixed hour per process, configured
with `WAITLIST_RATE_LIMIT_CAPACITY` and `WAITLIST_RATE_LIMIT_REFILL_MS`. The
body limit defaults to 8192 bytes and is configured by `WAITLIST_BODY_LIMIT_BYTES`.
A shared rate-limit store and trusted proxy configuration are needed for a
multi-process or proxied deployment. Contact uniqueness provides retry safety;
the public route does not require an idempotency key.

The waitlist response floor (`WAITLIST_MIN_RESPONSE_MS`, default 75 ms) hides differences below the floor. The per-IP limit of five requests per hour makes statistical timing attacks impractical; a slow database could still exceed the floor.
