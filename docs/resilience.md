# Outbound dependency resilience

`@yen/shared` exports `ResilientCall`, a bounded timeout/retry/circuit-breaker wrapper. It uses exponential backoff with full jitter, permits one half-open probe after the cooldown, and accepts injected clock, random source, and sleep function for deterministic tests.

| Dependency | Timeout | Attempts | Breaker | State |
|---|---:|---:|---:|---|
| Partner API | 5 s | 3 | 5 failures / 30 s | Policy only; no partner client exists yet |
| WhatsApp/SMS provider | 10 s | 2 | 5 failures / 60 s | Policy only; provider adapters exist, but are not wrapped here |
| Chain RPC | 10 s | 3 | 3 failures / 30 s | Configure `ResilientCall` at the `RootChain` boundary |
| ClamAV | configured scan timeout | 2 | 3 failures / 5 s | Applied to daemon VERSION and INSTREAM calls; uploads remain fail-closed |

Retry only operations whose effect is idempotent or protected by a stable idempotency key. Provider send retries require the provider to honor that key; a network timeout after provider acceptance is otherwise an ambiguous outcome. Breaker state is process-local.

## Reuse

Construct one `ResilientCall` per dependency and reuse it across calls. Do not construct one per request, which would reset breaker state. Supply `now`, `random`, and `sleep` in unit tests.
