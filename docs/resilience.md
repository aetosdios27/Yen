# Outbound dependency resilience

`@yen/shared` exports `ResilientCall`, a reusable timeout, bounded retry, and circuit-breaker wrapper. Retries use exponential backoff with full jitter. After the reset interval, one caller may make a half-open probe; success closes the breaker and failure reopens it. Tests can inject the clock, random source, and sleep function.

| Dependency            |                 Timeout | Attempts and jittered backoff                                                                      | Breaker                                      | Current integration                                                                                                                            |
| --------------------- | ----------------------: | -------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Partner API           |                     5 s | 3 attempts; 250 ms base, 2 s cap                                                                   | Opens after 5 failed calls; 30 s cooldown    | Policy only. No partner API client exists. The shared wrapper is ready for a future client.                                                    |
| WhatsApp/SMS provider |                    10 s | 2 attempts; 500 ms base, 5 s cap                                                                   | Opens after 5 failed calls; 60 s cooldown    | Policy only. No production messaging transport exists. The shared wrapper is ready for a future provider client.                               |
| Chain RPC             |                    10 s | Reads: 3 attempts; 250 ms base, 2 s cap. Publish: one attempt because acceptance can be ambiguous. | Opens after 3 exhausted calls; 30 s cooldown | Applied to `RootChain` calls in `AnchoringWorker`. Exhausted failures go to its injected alert sink; the CLI logs structured alerts to stderr. |
| ClamAV                | Configured scan timeout | 2 attempts; 100 ms base, 500 ms cap                                                                | Opens after 3 failed calls; 5 s cooldown     | Applied to ClamAV `VERSION` and `INSTREAM` requests. Uploads remain fail-closed.                                                               |

The wrapper counts one failed call after its configured attempts are exhausted. Breaker state is process-local. The shared unit tests cover timeout behavior, retry caps, and open, half-open, and close transitions. ClamAV and anchoring have their own client-level tests.

Retries are safe only for idempotent operations or operations protected by a stable idempotency key. Chain reads are retried; `publish` uses one attempt because a timeout cannot tell whether the chain accepted the transaction. The durable anchor lets the next worker run check the published root before submitting again. Messaging retries require the provider to honor the key; a local worker lease alone cannot guarantee exactly-once external effects.

## Reuse

Construct one `ResilientCall` per dependency and reuse it across calls so breaker state persists. Pass `now`, `random`, and `sleep` in tests for deterministic timing and backoff.
