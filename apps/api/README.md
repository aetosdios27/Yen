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
| `internal`             | 500    |

`src/errors.ts` owns the closed error-code schema and status table.
Every response carries `x-request-id`. A UUID-shaped inbound ID with a valid
version and variant is accepted; otherwise the server generates one.
Readiness defaults to success. Inject `readiness: async () => boolean` to check
dependencies; false or a thrown exception returns `internal`.

## Idempotency storage contract

Unsafe `/v1` requests require `Idempotency-Key` after authentication.
Keys contain 1 to 128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, and `-`.
The store key is the JSON tuple `[principal.id, headerValue]`.
The SHA-256 request hash binds the method, path and query, content type, and exact body bytes.
Different JSON whitespace therefore conflicts.

`IdempotencyStore.begin` must atomically reserve an absent key before returning `new`.
An existing reservation returns `in_progress`; completed entries return `complete`
with their original hash and full response. Changed input or a concurrent duplicate
returns `409 idempotency_conflict`. An in-progress response also has `retry-after: 1`.

`complete` stores status, all response headers, and a base64 body (`null` for a response with no body). Successful requests
and completed errors both replay with `idempotent-replayed: true`. The response body
is identical, including an original error's requestId; `x-request-id` identifies the
current HTTP request. Replays consume rate-limit tokens.

The interface maps to `idempotency_keys(key, request_hash, response jsonb, created_at)`:
`response = null` represents an in-progress reservation, and `response` stores the
`StoredResponse` object on completion. `createdAt` is epoch milliseconds.
A later Postgres adapter must enforce uniqueness atomically and complete a reservation
only when its hash matches. YEN-18/24 owns that implementation.

The in-memory store has process lifetime and retains reservations. If execution or
response persistence stops halfway, the key remains blocked to prevent duplicate
side effects. Durable transactional completion, crash recovery, retention, and cleanup
belong to the Postgres implementation. The mock is intended for local development.

## Rate limits and logs

Both token buckets apply to `/v1` requests. The default per-IP capacity is 120;
the per-principal capacity is 60. Both refill continuously over 60 seconds.
Configure positive integer `RATE_LIMIT_IP_CAPACITY`, `RATE_LIMIT_PRINCIPAL_CAPACITY`,
and `RATE_LIMIT_REFILL_MS` at startup. A rejected request returns `429` with integer
seconds in `retry-after`. Liveness and readiness bypass rate limits.

The Node entrypoint resolves the socket peer address. Forwarded headers are ignored.
Configure a trusted resolver explicitly when deploying behind a proxy.
Store instances are injectable and in-memory limits apply to one process.

Logs contain only event, UUID requestId, method, route template, status, and durationMs.
The JSON serializer strips unknown fields. No raw URL, query, body, header, principal,
phone number, authorization, cookie, or idempotency key is logged.

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
