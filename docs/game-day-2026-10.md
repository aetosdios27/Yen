# Game day report — 2026-10

## Scenarios

The existing opt-in Postgres chaos suite covers backend termination during a ledger transaction, abort between ledger posting and event append, concurrent reserve contention, and concurrent settlement retries. The randomized model runner executes 1,000 seeded operation/crash sequences; it is a state-machine check and does not replace the database-backed chaos suite.

## Seeds and results

See the run output recorded in the PR description. The generator uses a reproducible 32-bit seed and prints the seed for each failing case.

## Findings

The notification worker already uses a stable outbox idempotency key and verifies the claim fencing token before sending and before recording delivery. Exactly-once external effects still depend on the provider honoring the idempotency key. A crash after provider acceptance but before status persistence cannot be made exactly-once by local fencing alone.

Anchoring persists the root and salts before chain submission, so retry reuses the same persisted range/root. Alert delivery and HTTP serving are operational concerns outside the worker's current interface.

## Remaining

Partner API and messaging clients are not yet wired to the resilience wrapper. Chain outage alert-sink integration and end-to-end chain backlog draining require a configured alert sink and chain test environment. The randomized model does not simulate real Postgres or external provider behavior.
